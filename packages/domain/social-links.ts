import { isGoogleReviewUrl } from './review-link.js';

/*
 * Sosyal medya bağlantıları (Ayarlar → İşletme → Sosyal medya): the business's own Instagram, Facebook, TikTok, X, YouTube,
 * WhatsApp, web site, Google Haritalar and Google değerlendirme links. Only the domain's own review rules are imported: the
 * settings screen, the guest menu, the café server and Mola Merkez use the same rules. The owner may type a full link or a
 * plain handle ("@molacoffee", "0532 123 45 67"); every value is turned into one https link on the platform's own domain
 * before it is kept, so the guest menu, the permanent QR codes and the print cards only ever see links checked here.
 * `review` (6 Ekim): the Google review link, edited here since it became one of the rows; it is still STORED where it always
 * was (`State.googleReviewUrl`, review-link.ts rules), so older data and backups keep it without any migration step.
 * `socialLinksOf` puts the two together for every snapshot.
 */
export const socialPlatforms = ['instagram', 'facebook', 'tiktok', 'x', 'youtube', 'whatsapp', 'website', 'maps', 'review'] as const;
export type SocialPlatform = typeof socialPlatforms[number];
/** Normalised https links, one per filled platform (`State.socialLinks` without `review`; missing on older data = none). */
export type SocialLinks = Partial<Record<SocialPlatform, string>>;
/** The platforms a guest "follows" (every row but the Google review, which is asked for separately after the bill). */
export const followPlatforms = socialPlatforms.filter(p => p !== 'review');
export const isSocialPlatform = (v: unknown): v is SocialPlatform => socialPlatforms.includes(v as SocialPlatform);

type Info = { name: string; nameEn: string; follow: string; followEn: string; card: string; placeholder: string; hint: string };
/** Names and the plain sentences: `follow` is the icon's label ("Instagram'da takip edin"), `card` the print card's title. */
export const socialInfo: Record<SocialPlatform, Info> = {
  instagram: { name: 'Instagram', nameEn: 'Instagram', follow: 'Instagram’da takip edin', followEn: 'Follow us on Instagram', card: 'Bizi Instagram’da takip edin', placeholder: '@molacoffee', hint: 'Kullanıcı adı ya da profil bağlantısı.' },
  facebook: { name: 'Facebook', nameEn: 'Facebook', follow: 'Facebook’ta takip edin', followEn: 'Follow us on Facebook', card: 'Bizi Facebook’ta takip edin', placeholder: 'molacoffee ya da facebook.com/molacoffee', hint: 'Sayfa adı ya da sayfa bağlantısı.' },
  tiktok: { name: 'TikTok', nameEn: 'TikTok', follow: 'TikTok’ta takip edin', followEn: 'Follow us on TikTok', card: 'Bizi TikTok’ta takip edin', placeholder: '@molacoffee', hint: 'Kullanıcı adı ya da profil bağlantısı.' },
  x: { name: 'X (Twitter)', nameEn: 'X (Twitter)', follow: 'X’te takip edin', followEn: 'Follow us on X', card: 'Bizi X’te takip edin', placeholder: '@molacoffee', hint: 'Kullanıcı adı ya da x.com / twitter.com bağlantısı.' },
  youtube: { name: 'YouTube', nameEn: 'YouTube', follow: 'YouTube’da abone olun', followEn: 'Subscribe on YouTube', card: 'YouTube kanalımıza abone olun', placeholder: '@molacoffee', hint: 'Kanal adı (@ ile) ya da kanal bağlantısı; video bağlantısı olmaz.' },
  whatsapp: { name: 'WhatsApp', nameEn: 'WhatsApp', follow: 'WhatsApp’tan yazın', followEn: 'Message us on WhatsApp', card: 'Bize WhatsApp’tan yazın', placeholder: '0532 123 45 67', hint: 'İşletmenin WhatsApp numarası; wa.me bağlantısına çevrilir.' },
  website: { name: 'Web sitesi', nameEn: 'Website', follow: 'Web sitemizi ziyaret edin', followEn: 'Visit our website', card: 'Web sitemizi ziyaret edin', placeholder: 'molacoffee.com', hint: 'İşletmenizin kendi web sitesi.' },
  maps: { name: 'Google Haritalar', nameEn: 'Google Maps', follow: 'Google Haritalar’da konumumuz', followEn: 'Find us on Google Maps', card: 'Bizi Google Haritalar’da bulun', placeholder: 'https://maps.app.goo.gl/…', hint: 'Google Haritalar’da işletmenizi açın → Paylaş → Bağlantıyı kopyala.' },
  review: { name: 'Google değerlendirme', nameEn: 'Google review', follow: 'Google’da değerlendirin', followEn: 'Review us on Google', card: 'Bizi Google’da değerlendirin', placeholder: 'https://g.page/r/…/review', hint: 'Google İşletme Profilinizdeki değerlendirme bağlantısı ya da Google Haritalar işletme bağlantısı. Hesabı kapanan müşteriye “Google’da değerlendirin” düğmesi olarak gösterilir.' },
};

/** The longest link kept: Google Maps place links run long, the profile links never do. */
const MAX: Record<SocialPlatform, number> = { instagram: 200, facebook: 300, tiktok: 200, x: 200, youtube: 300, whatsapp: 200, website: 500, maps: 2048, review: 2048 };
export const SOCIAL_INPUT_MAX = 2048;
export type SocialResult = { ok: true; url: string } | { ok: false; error: string };
const fail = (error: string): SocialResult => ({ ok: false, error });
const done = (url: string): SocialResult => ({ ok: true, url });

/** Hosts of a platform: the bare domain and its www / m. forms. */
const on = (host: string, ...domains: string[]) => domains.some(d => host === d || host === `www.${d}` || host === `m.${d}` || host === `mobile.${d}` || host === `web.${d}`);
const segments = (u: URL) => u.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });

/**
 * A typed value as an https URL: a scheme other than http(s) is refused (javascript:, data:, ftp:…), http is upgraded to https,
 * a bare "instagram.com/x" gets https://; no user name, password or port; no spaces.
 */
function asUrl(text: string): URL | string {
  if (/\s/.test(text)) return 'Bağlantıda boşluk olamaz.';
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1].toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https' && !/^[^/]+\.[a-z]{2,}:\d+/i.test(text)) return 'Yalnız https:// ile başlayan bağlantılar kabul edilir.';
  const full = scheme === 'http' || scheme === 'https' ? text.replace(/^http:/i, 'https:') : `https://${text.replace(/^\/\//, '')}`;
  let u: URL;
  try { u = new URL(full); } catch { return 'Bağlantı okunamadı. Tarayıcıdaki adresi olduğu gibi yapıştırın.'; }
  if (u.protocol !== 'https:') return 'Yalnız https:// ile başlayan bağlantılar kabul edilir.';
  if (u.username || u.password) return 'Bağlantıda kullanıcı adı ya da şifre olamaz.';
  if (u.port) return 'Bağlantıda port numarası olamaz.';
  u.hash = '';
  return u;
}
const looksLikeLink = (text: string) => /^[a-z][a-z0-9+.-]*:/i.test(text) || text.includes('/');
const wrongSite = (domain: string) => `Bu bağlantı ${domain} adresine ait değil.`;

/** Instagram user names: letters, digits, "." and "_", at most 30, no dot at either end or twice in a row. */
const instagramName = (n: string) => /^[A-Za-z0-9._]{1,30}$/.test(n) && !n.startsWith('.') && !n.endsWith('.') && !n.includes('..');
const INSTAGRAM_PAGES = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'tv', 'direct', 'about', 'legal']);
const X_PAGES = new Set(['home', 'i', 'search', 'intent', 'share', 'explore', 'settings', 'login', 'messages', 'notifications', 'hashtag', 'compose']);
const FACEBOOK_PAGES = new Set(['login', 'login.php', 'sharer', 'sharer.php', 'dialog', 'plugins', 'groups', 'events', 'watch', 'photo.php', 'story.php']);

function instagram(text: string): SocialResult {
  const example = 'Kullanıcı adınızı (@molacoffee) ya da profil bağlantınızı yazın.';
  if (!looksLikeLink(text)) { const name = text.replace(/^@/, ''); return instagramName(name) ? done(`https://instagram.com/${name}`) : fail(example); }
  const u = asUrl(text); if (typeof u === 'string') return fail(u);
  if (!on(u.hostname, 'instagram.com', 'instagr.am')) return fail(wrongSite('instagram.com'));
  const [name, ...rest] = segments(u);
  if (!name || rest.length || INSTAGRAM_PAGES.has(name.toLowerCase()) || !instagramName(name)) return fail(`Profil bağlantısı olmalı (gönderi değil). ${example}`);
  return done(`https://instagram.com/${name}`);
}

function facebook(text: string): SocialResult {
  const example = 'Sayfa adınızı (molacoffee) ya da sayfa bağlantınızı yazın.';
  if (!looksLikeLink(text)) { const name = text.replace(/^@/, ''); return /^[A-Za-z0-9.-]{2,50}$/.test(name) ? done(`https://facebook.com/${name}`) : fail(example); }
  const u = asUrl(text); if (typeof u === 'string') return fail(u);
  if (u.hostname === 'fb.me') { const s = segments(u); return s.length === 1 && /^[A-Za-z0-9._-]{1,80}$/.test(s[0]) ? done(`https://fb.me/${s[0]}`) : fail(example); }
  if (!on(u.hostname, 'facebook.com', 'fb.com')) return fail(wrongSite('facebook.com'));
  const s = segments(u);
  if (u.pathname === '/profile.php') { const id = u.searchParams.get('id') ?? ''; return /^\d{3,25}$/.test(id) ? done(`https://facebook.com/profile.php?id=${id}`) : fail(example); }
  if (!s.length || s.length > 4 || FACEBOOK_PAGES.has(s[0].toLowerCase()) || !s.every(x => /^[\p{L}\p{N}._-]{1,80}$/u.test(x))) return fail(`Sayfa bağlantısı olmalı. ${example}`);
  return done(`https://facebook.com/${s.map(encodeURIComponent).join('/')}`);
}

function tiktok(text: string): SocialResult {
  const example = 'Kullanıcı adınızı (@molacoffee) ya da profil bağlantınızı yazın.';
  const ok = (n: string) => /^[A-Za-z0-9._]{2,24}$/.test(n) && !n.endsWith('.');
  if (!looksLikeLink(text)) { const name = text.replace(/^@/, ''); return ok(name) ? done(`https://www.tiktok.com/@${name}`) : fail(example); }
  const u = asUrl(text); if (typeof u === 'string') return fail(u);
  const s = segments(u);
  // Short share links from the app (vm.tiktok.com/ZM…) open the profile they were made from.
  if (u.hostname === 'vm.tiktok.com' || u.hostname === 'vt.tiktok.com') return s.length === 1 && /^[A-Za-z0-9]{4,20}$/.test(s[0]) ? done(`https://${u.hostname}/${s[0]}`) : fail(example);
  if (!on(u.hostname, 'tiktok.com')) return fail(wrongSite('tiktok.com'));
  if (s.length !== 1 || !s[0].startsWith('@') || !ok(s[0].slice(1))) return fail(`Profil bağlantısı olmalı (video değil). ${example}`);
  return done(`https://www.tiktok.com/${s[0]}`);
}

function x(text: string): SocialResult {
  const example = 'Kullanıcı adınızı (@molacoffee) ya da x.com bağlantınızı yazın.';
  const ok = (n: string) => /^[A-Za-z0-9_]{1,15}$/.test(n) && !X_PAGES.has(n.toLowerCase());
  if (!looksLikeLink(text)) { const name = text.replace(/^@/, ''); return ok(name) ? done(`https://x.com/${name}`) : fail(example); }
  const u = asUrl(text); if (typeof u === 'string') return fail(u);
  if (!on(u.hostname, 'x.com', 'twitter.com')) return fail(wrongSite('x.com'));
  const s = segments(u);
  if (s.length !== 1 || !ok(s[0])) return fail(`Profil bağlantısı olmalı (gönderi değil). ${example}`);
  return done(`https://x.com/${s[0]}`);
}

function youtube(text: string): SocialResult {
  const example = 'Kanal adınızı (@molacoffee) ya da kanal bağlantınızı yazın.';
  const handle = (n: string) => /^[A-Za-z0-9._-]{3,30}$/.test(n);
  if (!looksLikeLink(text)) { const name = text.replace(/^@/, ''); return handle(name) ? done(`https://www.youtube.com/@${name}`) : fail(example); }
  const u = asUrl(text); if (typeof u === 'string') return fail(u);
  if (u.hostname === 'youtu.be') return fail(`Bu bir video bağlantısı. ${example}`);
  if (!on(u.hostname, 'youtube.com')) return fail(wrongSite('youtube.com'));
  const [first, second] = segments(u);
  if (first?.startsWith('@') && handle(first.slice(1))) return done(`https://www.youtube.com/${first}`);
  if (first === 'channel' && /^UC[A-Za-z0-9_-]{22}$/.test(second ?? '')) return done(`https://www.youtube.com/channel/${second}`);
  if ((first === 'c' || first === 'user') && /^[A-Za-z0-9._-]{1,100}$/.test(second ?? '')) return done(`https://www.youtube.com/${first}/${second}`);
  return fail(`Kanal bağlantısı olmalı (video değil). ${example}`);
}

/** A phone number as wa.me wants it: country code and number, digits only ("0532…" and "532…" are Turkish numbers). */
export function whatsappDigits(text: string): string | null {
  if (!/^[+\d\s().-]+$/.test(text)) return null;
  let digits = text.replace(/\D/g, '');
  if (!text.trim().startsWith('+')) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) digits = `90${digits.slice(1)}`;
    else if (digits.length === 10 && digits.startsWith('5')) digits = `90${digits}`;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}
function whatsapp(text: string): SocialResult {
  const example = 'Numarayı yazın (0532 123 45 67 ya da +90 532 123 45 67) ya da wa.me bağlantısını yapıştırın.';
  if (!looksLikeLink(text)) { const digits = whatsappDigits(text); return digits ? done(`https://wa.me/${digits}`) : fail(example); }
  const u = asUrl(text); if (typeof u === 'string') return fail(u);
  const s = segments(u);
  if (u.hostname === 'wa.me') {
    if (s.length === 1 && /^[1-9]\d{7,14}$/.test(s[0])) return done(`https://wa.me/${s[0]}`);
    // WhatsApp Business "kısa bağlantı" (wa.me/message/ABC…).
    if (s.length === 2 && s[0] === 'message' && /^[A-Za-z0-9]{6,40}$/.test(s[1])) return done(`https://wa.me/message/${s[1]}`);
    return fail(example);
  }
  if (on(u.hostname, 'whatsapp.com', 'api.whatsapp.com') || u.hostname === 'api.whatsapp.com') {
    const phone = u.searchParams.get('phone')?.replace(/\D/g, '') ?? '';
    return s[0] === 'send' && /^[1-9]\d{7,14}$/.test(phone) ? done(`https://wa.me/${phone}`) : fail(example);
  }
  return fail(wrongSite('wa.me'));
}

function website(text: string): SocialResult {
  const u = asUrl(text); if (typeof u === 'string') return fail(u);
  const host = u.hostname;
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(host) || /^[\d.]+$/.test(host) || host.endsWith('.local') || host.endsWith('.localhost')) return fail('İnternetteki web sitenizin adresini yazın (örn. molacoffee.com).');
  return done(u.href);
}

const MAP_HOSTS = ['google.com', 'google.com.tr', 'maps.google.com', 'maps.google.com.tr'];
function maps(text: string): SocialResult {
  const example = 'Google Haritalar’da işletmenizi açın, Paylaş → Bağlantıyı kopyala ile aldığınız bağlantıyı yapıştırın.';
  if (!looksLikeLink(text) && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(text)) return fail(example);
  const u = asUrl(text); if (typeof u === 'string') return fail(u);
  const host = u.hostname, path = u.pathname;
  const fine = host === 'maps.app.goo.gl' ? path.length > 1
    : host === 'goo.gl' ? path.startsWith('/maps/') && path.length > 6
      : host === 'g.page' ? path.length > 1
        : host === 'share.google' ? /^\/[A-Za-z0-9_-]+$/.test(path)
          : MAP_HOSTS.some(d => host === d || host === `www.${d}`) ? path.startsWith('/maps') || (host.startsWith('maps.') && (u.searchParams.has('q') || u.searchParams.has('cid')))
            : null;
  if (fine === null) return fail(wrongSite('Google Haritalar'));
  return fine ? done(u.href) : fail(example);
}

/**
 * Google değerlendirme: the review link rules of review-link.ts (share.google, g.page, maps.app.goo.gl, Google Maps, the
 * writereview link). Kept as typed (only http → https and a missing https:// added), so a stored link stays the same link.
 */
function review(text: string): SocialResult {
  const example = 'Google İşletme Profilinizdeki değerlendirme bağlantısını ya da Google Haritalar işletme bağlantısını yapıştırın.';
  if (/\s/.test(text)) return fail('Bağlantıda boşluk olamaz.');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1].toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') return fail('Yalnız https:// ile başlayan bağlantılar kabul edilir.');
  const full = scheme ? text.replace(/^http:/i, 'https:') : `https://${text.replace(/^\/\//, '')}`;
  if (!looksLikeLink(full) || !isGoogleReviewUrl(full)) return fail(`Geçerli bir Google değerlendirme ya da Google Haritalar bağlantısı değil. ${example}`);
  return done(full);
}

const rules: Record<SocialPlatform, (text: string) => SocialResult> = { instagram, facebook, tiktok, x, youtube, whatsapp, website, maps, review };
/** One typed value → the link that is kept, or a plain reason. Empty means "not used" (`url: ''`). */
export function normalizeSocial(platform: SocialPlatform, raw: string): SocialResult {
  const text = (raw ?? '').trim();
  if (!text) return done('');
  if (text.length > SOCIAL_INPUT_MAX) return fail('Bağlantı çok uzun.');
  const result = rules[platform](text);
  if (result.ok && result.url.length > MAX[platform]) return fail('Bağlantı çok uzun.');
  return result;
}
/** A stored link is shown only while it still passes the rules (older or hand-edited data never reaches a guest unchecked). */
export const validSocial = (platform: SocialPlatform, url: unknown) => typeof url === 'string' && !!url && (() => { const r = normalizeSocial(platform, url); return r.ok && r.url === url; })();

/** Everything the owner sent: the links to keep, and per platform why a value was refused (unknown names refused too). */
export function normalizeSocialLinks(input: Record<string, unknown>): { links: SocialLinks; errors: Partial<Record<string, string>> } {
  const links: SocialLinks = {}, errors: Partial<Record<string, string>> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (!isSocialPlatform(key)) { errors[key] = 'Bilinmeyen bağlantı türü.'; continue; }
    if (typeof value !== 'string') { errors[key] = 'Bağlantı yazı olmalı.'; continue; }
    const r = normalizeSocial(key, value);
    if (!r.ok) errors[key] = r.error; else if (r.url) links[key] = r.url;
  }
  return { links, errors };
}

/** The filled, still valid links in the fixed order (Instagram first, Google Haritalar and the Google review last). */
export function socialEntries(links: SocialLinks | undefined | null, without: readonly SocialPlatform[] = []): { platform: SocialPlatform; url: string }[] {
  if (!links || typeof links !== 'object') return [];
  return socialPlatforms.filter(p => !without.includes(p) && validSocial(p, links[p])).map(p => ({ platform: p, url: links[p]! }));
}
/** The same links as an object, or undefined when none: what the snapshots carry. */
export function cleanSocialLinks(links: SocialLinks | undefined | null): SocialLinks | undefined {
  const entries = socialEntries(links);
  return entries.length ? Object.fromEntries(entries.map(e => [e.platform, e.url])) as SocialLinks : undefined;
}
/**
 * Every snapshot's `socialLinks`: the stored social links plus the Google review link (kept in `googleReviewUrl`, see above),
 * checked; undefined when there is none. Data from before the Google row (only `googleReviewUrl`) shows it as the `review` row.
 */
export function socialLinksOf(s: { socialLinks?: SocialLinks; googleReviewUrl?: string }): SocialLinks | undefined {
  const { review: _stray, ...stored } = s.socialLinks ?? {};
  return cleanSocialLinks({ ...stored, ...(s.googleReviewUrl ? { review: s.googleReviewUrl } : {}) });
}
/**
 * The guest snapshot's part: every link, or, when "Sosyal medya ve QR kartları" is not in the package (paid since 6 Ekim),
 * only the Google review row (core: the after-payment "Google'da değerlendirin" button) and `socialOff` (no "Bizi takip
 * edin" row at the menu's foot). The other links stay stored; they simply are not sent.
 */
export function guestSocial(s: { socialLinks?: SocialLinks; googleReviewUrl?: string }, paid: boolean): { socialLinks?: SocialLinks; socialOff?: true } {
  const all = socialLinksOf(s);
  return paid ? { socialLinks: all } : { ...(all?.review ? { socialLinks: { review: all.review } } : {}), socialOff: true };
}

/*
 * The permanent social QR codes do not hold the link itself (6 Ekim): they hold a short address at Mola Merkez,
 * `<Merkez>/s/<code>/<platform>`, which forwards to the link while the business's licence is active (and shows "Bu işletmenin bu
 * hizmeti şu anda kullanılamıyor." while it is suspended, expired or frozen). `code` is one random code per business, given by
 * Merkez once and never changed: an edited link keeps its printed QR, and nothing about one business leads to another's.
 */
export const SOCIAL_CODE = /^[A-Za-z0-9]{10}$/;
export const socialShortUrl = (base: string, code: string, platform: SocialPlatform) => `${base.replace(/\/+$/, '')}/s/${code}/${platform}`;

/** "+90 532 123 45 67" for a Turkish mobile number, "+44 2071234567" style otherwise. */
export function phoneText(digits: string) {
  const tr = /^90(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(digits);
  return tr ? `+90 ${tr[1]} ${tr[2]} ${tr[3]} ${tr[4]}` : `+${digits}`;
}
/** The short text under a QR code and in the preview chip: "@molacoffee", "+90 532 123 45 67", "molacoffee.com". */
export function socialHandle(platform: SocialPlatform, url: string): string {
  let u: URL; try { u = new URL(url); } catch { return url; }
  const s = segments(u);
  switch (platform) {
    case 'instagram': case 'x': return s[0] ? `@${s[0]}` : socialInfo[platform].name;
    case 'tiktok': return s[0]?.startsWith('@') ? s[0] : 'TikTok';
    case 'youtube': return s[0]?.startsWith('@') ? s[0] : s[0] === 'channel' ? 'YouTube kanalı' : s[1] ?? 'YouTube';
    case 'facebook': return u.pathname === '/profile.php' || u.hostname === 'fb.me' ? `${u.hostname}${u.pathname}` : `facebook.com/${s.join('/')}`;
    case 'whatsapp': return s[0] === 'message' ? 'WhatsApp' : phoneText(s[0] ?? '');
    case 'website': { const host = u.hostname.replace(/^www\./, ''), path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''); const text = host + path; return text.length > 40 ? `${text.slice(0, 39)}…` : text; }
    case 'maps': return 'Konum ve yol tarifi';
    case 'review': return 'Yıldız verin, yorum yazın';
  }
}
