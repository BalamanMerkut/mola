/*
 * molayazilim.com.tr: the public web site, built into site/dist (static files; Caddy serves them on the VDS).
 *   npm.cmd run site:build     build once (warnings for contact details still to fill in site/config.json)
 *   npm.cmd run site:dev       build, serve on http://127.0.0.1:5180 and rebuild on every change (scripts/site-dev.ts)
 * Sources: site/src/layout.html (head, header, footer), site/src/pages/*.html (one page each, a `<!--page …-->` block on
 * top), site/src/assets (CSS, JS, videos and stills from `npm run site:videos`), site/config.json (phone, WhatsApp, e-mail…).
 * The service and package lists come from packages/domain/features.ts (names, "Yakında", what each package holds; never a
 * price), the form's limits and KVKK text version from packages/domain/site-lead.ts. Icons are lucide (the app's own set),
 * drawn into the HTML at build time: the site loads no script, font or style from anywhere else and sets no cookie.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as lucide from 'lucide-react';
import sharp from 'sharp';
import { defaultPackages, featureById, features, type FeatureId } from '../packages/domain/features.js';
import { SITE_CONSENT_VERSION, SITE_LEAD_LIMITS, SITE_LEAD_TYPE_NAMES, SITE_LEAD_TYPES } from '../packages/domain/site-lead.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SITE = join(ROOT, 'site'), SRC = join(SITE, 'src'), DIST = join(SITE, 'dist');

/**
 * `downloads` ("Uygulamayı indir", /indir/): filled by `npm run site:indir` (scripts/site-indir.ts) from the installer folder.
 * Every platform reads "Yakında" until `enabled` is true: the owner turns it on once the installers built for the VDS Merkez
 * exist (the ones built on his computer point to 127.0.0.1).
 */
export const PLATFORMS = ['windows', 'macos-arm64', 'macos-x64', 'linux-x64'] as const;
export type Platform = typeof PLATFORMS[number];
export type DownloadFile = { file: string; size: number; sha256: string };
export type Downloads = { enabled: boolean; version: string; builtAt?: string; files: Partial<Record<Platform, DownloadFile>> };
type Config = { siteUrl: string; phone: string; whatsapp: string; email: string; address: string; hours: string; company: string; legalDraft: boolean; legalUpdated: string; downloads?: Downloads };
type Video = { name: string; caption: string; kind: 'phone' | 'desktop'; seconds?: number; kb?: number };
type PageMeta = { path: string; title: string; description: string; nav?: string; robots?: string; file: string; body: string };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const trDate = (day: string) => { const [y, m, d] = day.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
/** "X" in a number = not filled in yet. */
const filled = (v: string) => !!v.trim() && !/x/i.test(v);
const digits = (v: string) => v.replace(/\D/g, '');
/** +90 5XX… or 05XX… → 905XXXXXXXXX (wa.me and tel: want it so). */
const intl = (v: string) => { const d = digits(v); return d.startsWith('90') ? d : d.startsWith('0') ? `9${d}` : `90${d}`; };

// ---------- Icons (lucide, the app's set) ----------
const iconCache = new Map<string, string>();
export function icon(name: string, size = 24) {
  const key = `${name}:${size}`;
  if (!iconCache.has(key)) {
    const component = (lucide as unknown as Record<string, unknown>)[name];
    if (!component) throw new Error(`Simge yok: ${name}`);
    iconCache.set(key, renderToStaticMarkup(createElement(component as never, { size, strokeWidth: 1.9, className: 'icon', 'aria-hidden': 'true', focusable: 'false' } as never)));
  }
  return iconCache.get(key)!;
}

// ---------- Site copy for each service (names and "Yakında" come from features.ts) ----------
const SERVICE_COPY: Record<FeatureId, { icon: string; text: string }> = {
  core: { icon: 'Store', text: 'Masalar, garsonun aldığı sipariş, masasız (al götür) satış, mutfak ekranı ve fişi, kasa ve gün sonu, menü ve kampanyalar, temel raporlar, müdür hesabı ve Android uygulaması.' },
  'qr-menu': { icon: 'QrCode', text: 'Her masanın kendi QR kodu. Müşteri telefon kamerasıyla okutur; fotoğraflı, Türkçe ve İngilizce menü açılır. Uygulama indirmek gerekmez.' },
  'qr-order': { icon: 'Send', text: 'Müşteri siparişini menüden kendisi gönderir, garson çağırır, hesabı ister. İsterseniz QR siparişleri önce garson onayından geçer.' },
  'reports-advanced': { icon: 'FileSpreadsheet', text: 'Raporu yazdırın ya da PDF alın, muhasebeciniz için Excel indirin. KDV dökümü, kanal ve dönem karşılaştırmaları.' },
  stock: { icon: 'Boxes', text: 'Malzeme stoğu ve reçeteler; satıldıkça düşen stok, “kaç adet yapılabilir” bilgisi, ürün bazında kâr ve düşük kâr uyarısı.' },
  reservations: { icon: 'CalendarDays', text: 'Masa ayırma ve kapora, “Geldi mi?” hatırlatması. Maç ve özel günler için geçici masalarla etkinlik ve ayrı etkinlik raporu.' },
  shifts: { icon: 'Clock', text: 'Kasadaki tek kullanımlık kodla vardiya başlangıcı ve bitişi; çalışma saati, geç kalma, saat başı satış ve bahşiş paylaşımı.' },
  social: { icon: 'Share2', text: 'Instagram, WhatsApp, Google ve diğer bağlantılarınız menünün altında; masaya koyacağınız kalıcı QR kartları.' },
  'remote-reports': { icon: 'ChartLine', text: 'İşletmede değilken bugünün satışı, kasa ve raporlar telefonunuzda. Uçtan uca şifreli: aradaki sunucu içini göremez.' },
  'remote-admin': { icon: 'KeyRound', text: 'Eşleştirdiğiniz telefondan kafenizin ekranlarını sahip olarak açın; şifre ve doğrulama koduyla.' },
  'email-reports': { icon: 'Mail', text: 'Gün, hafta, ay ve yıl sonu raporu PDF ekiyle e-postanıza gelir.' },
  'split-screen': { icon: 'Columns2', text: 'Kasa bilgisayarında ekranı ikiye bölün; iki hesap yan yana çalışsın.' },
  'cloud-backup': { icon: 'CloudUpload', text: 'Gece yedeğinizin şifreli bir kopyası Mola sunucusunda durur; bilgisayar bozulursa yeni bilgisayara kolayca taşınır.' },
  integrations: { icon: 'Bike', text: 'Yemeksepeti, Getir ve Trendyol gibi paket servis platformlarının siparişleri doğrudan mutfağa düşecek. Platformlarla çalışmalar sürüyor.' },
};
const PACKAGE_COPY: Record<string, string> = {
  'cay-bahcesi': 'Hızlı servis, kalabalık masalar, sade raporlar. Çay bahçeleri ve küçük kafeler için.',
  'kafe-standart': 'Çoğu kafe için: QR sipariş, stok ve kârlılık, telefondan rapor.',
  'restoran-pro': 'Rezervasyon, vardiya, iki ekran ve gelişmiş raporlarla tam donanım. Restoranlar ve büyük kafeler için.',
};
function servicesHtml() {
  const missing = features.filter(f => !SERVICE_COPY[f.id]).map(f => f.id);
  if (missing.length) throw new Error(`site-build: bu hizmetlerin site metni yok (SERVICE_COPY): ${missing.join(', ')}`);
  const cards = features.map(f => {
    const copy = SERVICE_COPY[f.id], chips: string[] = [];
    if (f.required) chips.push('<span class="chip chip-core">Her pakette</span>');
    if (f.soon) chips.push('<span class="chip chip-soon">Yakında</span>');
    for (const need of f.requires ?? []) chips.push(`<span class="chip">${esc(featureById.get(need)!.name)} ile</span>`);
    return `<article class="card feature-card reveal${f.soon ? ' soon' : ''}" data-hizmet="${f.id}"><div class="card-icon">${icon(copy.icon)}</div><h3>${esc(f.name)}</h3><p>${esc(copy.text)}</p>${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}</article>`;
  });
  return `<div class="cards services">${cards.join('\n')}</div>`;
}
function packagesHtml() {
  return `<div class="packages">${defaultPackages.map(p => {
    const list = p.features.map(id => featureById.get(id)).filter(f => f && !f.soon).map(f => `<li>${icon('Check', 18)}${esc(f!.name)}</li>`).join('');
    return `<article class="package reveal${p.id === 'kafe-standart' ? ' featured' : ''}" data-paket="${esc(p.id)}"><h3>${esc(p.name)}</h3><p>${esc(PACKAGE_COPY[p.id] ?? '')}</p><ul>${list}</ul><a class="btn ${p.id === 'kafe-standart' ? 'btn-primary' : 'btn-ghost'}" href="/iletisim/#form">Bu paketi soralım</a></article>`;
  }).join('\n')}</div>`;
}

// ---------- Uygulamayı indir (/indir/) ----------
const PLATFORM_COPY: Record<Platform, { icon: string; name: string; sub: string; how: string }> = {
  windows: { icon: 'Monitor', name: 'Windows 10 / 11', sub: 'Mola kurulum · çoğu kafe bilgisayarı', how: 'ZIP dosyasını açın (sağ tık → Tümünü ayıkla), içindeki “Mola Kurulum.exe”ye çift tıklayın, “Kur”a basın.' },
  'macos-arm64': { icon: 'Laptop', name: 'Mac · Apple Silicon', sub: 'M1, M2, M3, M4 işlemcili Mac’ler (2020 sonrası)', how: 'Dosyaya çift tıklayın; açılan “Mola” klasöründeki BENIOKU.txt’yi izleyin.' },
  'macos-x64': { icon: 'Laptop', name: 'Mac · Intel', sub: 'Intel işlemcili Mac’ler', how: 'Dosyaya çift tıklayın; açılan “Mola” klasöründeki BENIOKU.txt’yi izleyin.' },
  'linux-x64': { icon: 'HardDrive', name: 'Linux', sub: 'Ubuntu, Pardus, Mint, Debian…', how: 'Arşivi açın; “Mola” klasöründeki BENIOKU.txt’yi izleyin.' },
};
function downloadsOf(config: Config, dist: string, warnings: string[]): Downloads {
  const d = config.downloads ?? { enabled: false, version: '', files: {} };
  if (d.enabled) for (const p of PLATFORMS) {
    const f = d.files?.[p];
    if (!f) warnings.push(`İndirme açık ama ${PLATFORM_COPY[p].name} dosyası config.json'da yok (o kart "Yakında" görünür).`);
    else if (!existsSync(join(dist, 'indir', f.file))) warnings.push(`İndirme dosyası yok: ${relative(ROOT, join(dist, 'indir', f.file))} (npm.cmd run site:indir)`);
  }
  return { enabled: !!d.enabled, version: d.version || '', files: d.files ?? {}, ...(d.builtAt ? { builtAt: d.builtAt } : {}) };
}
const megabytes = (n: number) => `${(n / 1048576).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} MB`;
function downloadsHtml(d: Downloads) {
  const cards = PLATFORMS.map(p => {
    const c = PLATFORM_COPY[p], f = d.enabled ? d.files[p] : undefined;
    const action = f
      ? `<a class="btn btn-primary" href="/indir/${encodeURIComponent(f.file)}" download data-indir="${p}">${icon('Download')} İndir</a><small class="dl-meta">${esc(f.file)} · ${megabytes(f.size)}</small><details class="dl-sum"><summary>Dosya doğrulama (SHA-256)</summary><code>${esc(f.sha256)}</code></details>`
      : `<span class="btn btn-ghost dl-soon" aria-disabled="true">Yakında</span><small class="dl-meta">Kurulum dosyası hazırlanıyor. Şimdilik kurulumu biz yapıyoruz: <a href="/iletisim/#form">bize ulaşın</a>.</small>`;
    return `<article class="card dl-card reveal${f ? '' : ' soon'}" data-platform="${p}"><div class="card-icon">${icon(c.icon)}</div><h3>${esc(c.name)}</h3><p class="dl-sub">${esc(c.sub)}</p>${f ? `<p>${esc(c.how)}</p>` : ''}<div class="dl-action">${action}</div></article>`;
  });
  return `<div class="cards dl-cards" data-indir-acik="${d.enabled ? '1' : '0'}">${cards.join('\n')}</div>`;
}

// ---------- Media ----------
async function imageSize(file: string) { const m = await sharp(file).metadata(); return { width: m.width ?? 0, height: m.height ?? 0 }; }
function videosIndex(): Video[] {
  const file = join(SRC, 'assets', 'video', 'videolar.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Video[] : [];
}

export type BuildResult = { pages: number; warnings: string[]; bytes: number; files: number };
/** `config`: another config file (tests, scripts/ev-provasi.ts); `dist`: another output folder (the real one is site/dist). */
export async function buildSite(o: { quiet?: boolean; config?: string; dist?: string } = {}): Promise<BuildResult> {
  const warnings: string[] = [], dist = o.dist ? resolve(o.dist) : DIST;
  // No open-file cache: on Windows it would keep images locked while `npm run site:videos` replaces them.
  sharp.cache(false);
  const config =JSON.parse(readFileSync(o.config ?? join(SITE, 'config.json'), 'utf8')) as Config;
  const downloads = downloadsOf(config, dist, warnings);
  for (const k of ['siteUrl', 'email', 'address', 'company'] as const) if (!config[k]?.trim()) throw new Error(`site/config.json: "${k}" boş olamaz.`);
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(config.siteUrl)) throw new Error('site/config.json: siteUrl "https://alanadi" biçiminde olmalı (sonunda / olmadan).');
  if (!filled(config.phone)) warnings.push('site/config.json: telefon numarası henüz doldurulmadı (sitede "yakında" görünür).');
  if (!filled(config.whatsapp)) warnings.push('site/config.json: WhatsApp numarası henüz doldurulmadı (sitede "yakında" görünür).');
  if (config.legalDraft) warnings.push('Yasal metinler TASLAK olarak işaretli (avukat kontrolünden sonra config.json → legalDraft: false).');

  // dist/indir holds the installers copied by `npm run site:indir` (large): kept across builds.
  if (existsSync(dist)) for (const entry of readdirSync(dist)) if (entry !== 'indir') rmSync(join(dist, entry), { recursive: true, force: true });
  mkdirSync(join(dist, 'assets', 'img'), { recursive: true });
  // Assets: everything under site/src/assets except the index of the videos (read here) and the CSS/JS (processed below).
  const copyTree = (from: string, to: string) => {
    for (const entry of readdirSync(from)) {
      const a = join(from, entry), b = join(to, entry);
      if (statSync(a).isDirectory()) { mkdirSync(b, { recursive: true }); copyTree(a, b); }
      else if (!['videolar.json', 'site.css', 'site.js'].includes(entry)) copyFileSync(a, b);
    }
  };
  copyTree(join(SRC, 'assets'), join(dist, 'assets'));
  const css = readFileSync(join(SRC, 'assets', 'site.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{};,>])\s*/g, '$1').replace(/;}/g, '}').trim();
  const js = readFileSync(join(SRC, 'assets', 'site.js'), 'utf8');
  writeFileSync(join(dist, 'assets', 'site.css'), css); writeFileSync(join(dist, 'assets', 'site.js'), js);
  const version = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 10);

  // Icons from the Mola mark (the same drawing as the app and the Android icon).
  const mark = readFileSync(join(ROOT, 'scripts', 'desktop', 'mola-icon.svg'));
  writeFileSync(join(dist, 'favicon.svg'), mark);
  await sharp(mark, { density: 300 }).resize(32, 32).png().toFile(join(dist, 'favicon-32.png'));
  await sharp(mark, { density: 300 }).resize(180, 180).flatten({ background: '#234c3e' }).png().toFile(join(dist, 'apple-touch-icon.png'));
  // Merkut Studios: the square eagle mark of the logo, small, for the footer.
  const studio = join(ROOT, 'brand', 'merkut-studios', 'merkut-studios-logo.jpg');
  { const m = await sharp(studio).metadata(), w = m.width!, h = m.height!; await sharp(studio).extract({ left: Math.round(w * .128), top: Math.round(h * .024), width: Math.round(w * .754), height: Math.round(w * .754) }).resize(96, 96).webp({ quality: 82 }).toFile(join(dist, 'assets', 'img', 'merkut-studios.webp')); }
  await ogImage(join(dist, 'assets', 'img', 'og.png'));

  const videos = videosIndex();
  const sizes = new Map<string, { width: number; height: number }>();
  for (const f of existsSync(join(SRC, 'assets', 'img')) ? readdirSync(join(SRC, 'assets', 'img')) : []) if (f.endsWith('.webp')) sizes.set(f.replace(/\.webp$/, ''), await imageSize(join(SRC, 'assets', 'img', f)));

  const phoneHref = filled(config.phone) ? `tel:+${intl(config.phone)}` : '';
  const waHref = filled(config.whatsapp) ? `https://wa.me/${intl(config.whatsapp)}?text=${encodeURIComponent('Merhaba, Mola hakkında bilgi almak istiyorum.')}` : '';
  const mailHref = `mailto:${config.email}`;
  const year = String(new Date().getFullYear());
  const contactCard = (kind: 'whatsapp' | 'phone' | 'email', href: string, title: string, value: string) => href
    ? `<a class="contact-item c-${kind}" href="${esc(href)}"${kind === 'whatsapp' ? ' rel="noopener"' : ''}><span class="card-icon">${icon(kind === 'whatsapp' ? 'MessageCircle' : kind === 'phone' ? 'Phone' : 'Mail')}</span><span><b>${title}</b><span>${esc(value)}</span></span></a>`
    : `<div class="contact-item c-${kind} pending" aria-disabled="true"><span class="card-icon">${icon(kind === 'whatsapp' ? 'MessageCircle' : 'Phone')}</span><span><b>${title}</b><span>Numara yakında burada</span></span></div>`;
  const tokens = (name: string, arg: string | undefined, page: PageMeta): string => {
    switch (name) {
      case 'icon': return icon(arg!);
      case 'year': return year;
      case 'siteUrl': return config.siteUrl;
      case 'email': return esc(config.email);
      case 'address': return esc(config.address);
      case 'hours': return esc(config.hours);
      case 'company': return esc(config.company);
      case 'phone': return filled(config.phone) ? esc(config.phone) : '<span class="placeholder">telefon numarası</span>';
      case 'phoneLink': return filled(config.phone) ? `<a href="${phoneHref}">${esc(config.phone)}</a>` : '<span class="placeholder">telefon numarası</span>';
      case 'emailLink': return `<a href="${mailHref}">${esc(config.email)}</a>`;
      case 'legalUpdated': return trDate(config.legalUpdated);
      case 'consentVersion': return SITE_CONSENT_VERSION;
      case 'draftBanner': return config.legalDraft ? `<p class="draft-banner" role="note">${icon('TriangleAlert')}<span>TASLAK — avukat tarafından kontrol edilecektir. Bu metin henüz son hâlini almadı.</span></p>` : '';
      case 'services': return servicesHtml();
      case 'downloads': return downloadsHtml(downloads);
      case 'downloadVersion': return downloads.version ? ` · sürüm ${esc(downloads.version)}` : '';
      case 'packages': return packagesHtml();
      case 'whatsappButton': return waHref ? `<a class="${esc(arg ?? 'btn btn-ghost')}" href="${esc(waHref)}" rel="noopener">${icon('MessageCircle')} WhatsApp’tan yazın</a>` : '';
      case 'contactCards': return [contactCard('whatsapp', waHref, 'WhatsApp’tan yazın', config.whatsapp), contactCard('phone', phoneHref, 'Bizi arayın', config.phone), contactCard('email', mailHref, 'E-posta gönderin', config.email)].join('\n');
      case 'typeOptions': return SITE_LEAD_TYPES.map(t => `<label><input type="radio" name="type" value="${t}" required><span>${esc(SITE_LEAD_TYPE_NAMES[t])}</span></label>`).join('');
      case 'max': return String((SITE_LEAD_LIMITS as Record<string, { max: number }>)[arg!].max);
      case 'shot': case 'phoneShot': {
        const [file, alt = '', kind = name === 'phoneShot' ? 'phone' : 'window', label = ''] = (arg ?? '').split('|');
        const size = sizes.get(file);
        if (!size) { warnings.push(`${page.file}: görsel yok: ${file}.webp (npm run site:videos üretir)`); return ''; }
        const img = `<img src="/assets/img/${file}.webp" width="${size.width}" height="${size.height}" alt="${esc(alt)}" decoding="async"${page.path === '/' ? ' fetchpriority="high"' : ' loading="lazy"'}>`;
        return kind === 'phone' ? `<div class="phone"><div class="screen">${img}</div></div>` : `<div class="window"><div class="window-bar" aria-hidden="true"><span></span><span></span><span></span><em>${esc(label)}</em></div>${img}</div>`;
      }
      case 'video': {
        const v = videos.find(x => x.name === arg);
        if (!v) { warnings.push(`${page.file}: video yok: ${arg} (npm run site:videos)`); return `<p class="clip-caption">Video hazırlanıyor.</p>`; }
        const poster = `/assets/video/${v.name}.jpg`, src = `/assets/video/${v.name}.mp4`;
        const video = `<video muted loop playsinline preload="none" poster="${poster}" data-src="${src}" aria-label="${esc(v.caption)}" width="${v.kind === 'phone' ? 480 : 1280}" height="${v.kind === 'phone' ? 1040 : 800}"></video><button class="clip-toggle" type="button" hidden aria-label="Videoyu oynat"></button>`;
        const framed = v.kind === 'phone' ? `<div class="phone"><div class="screen clip">${video}</div></div>` : `<div class="window clip"><div class="window-bar" aria-hidden="true"><span></span><span></span><span></span><em>Mola · Örnek Kafe</em></div>${video}</div>`;
        return `<figure class="clip-figure">${framed}<figcaption class="clip-caption">${esc(v.caption)}</figcaption></figure>`;
      }
      default: throw new Error(`${page.file}: bilinmeyen yer tutucu {{${name}${arg ? `:${arg}` : ''}}}`);
    }
  };
  const fill = (text: string, page: PageMeta) => text.replace(/\{\{([a-zA-Z]+)(?::([^}]*))?\}\}/g, (_m, name: string, arg?: string) => tokens(name, arg, page));

  const layout = readFileSync(join(SRC, 'layout.html'), 'utf8');
  const pages = readdirSync(join(SRC, 'pages')).filter(f => f.endsWith('.html')).map(file => parsePage(file, readFileSync(join(SRC, 'pages', file), 'utf8')));
  const footerContact = [filled(config.phone) ? `<li><a href="${phoneHref}">${esc(config.phone)}</a></li>` : '', waHref ? `<li><a href="${esc(waHref)}" rel="noopener">WhatsApp</a></li>` : '', `<li><a href="${mailHref}">${esc(config.email)}</a></li>`].join('');
  const cssVersion = version(css), jsVersion = version(js);
  for (const page of pages) {
    const content = fill(page.body, page);
    const canonical = `${config.siteUrl}${page.path === '404' ? '/' : page.path}`;
    const structured = page.path === '/' ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Mola', applicationCategory: 'BusinessApplication', operatingSystem: 'Windows, Android, iOS (web)', description: page.description, url: config.siteUrl, inLanguage: 'tr', publisher: { '@type': 'Organization', name: config.company, email: config.email, address: { '@type': 'PostalAddress', addressLocality: config.address, addressCountry: 'TR' } } })}</script>` : '';
    let html = layout.replace('{{content}}', () => content).replace('{{structuredData}}', () => structured)
      .replace(/\{\{current:([a-z]+)\}\}/g, (_m, nav: string) => nav === page.nav ? 'aria-current="page"' : '')
      .replace(/\{\{(pageTitle|description|canonical|robots|cssVersion|jsVersion|footerContact)\}\}/g, (_m, k: string) => ({ pageTitle: esc(page.title), description: esc(page.description), canonical: esc(canonical), robots: page.robots ?? 'index, follow', cssVersion, jsVersion, footerContact } as Record<string, string>)[k]);
    html = fill(html, page);
    const out = page.path === '404' ? join(dist, '404.html') : join(dist, page.path, 'index.html');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);
  }
  const indexed = pages.filter(p => p.path !== '404' && !(p.robots ?? '').includes('noindex'));
  writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexed.map(p => `  <url><loc>${config.siteUrl}${p.path}</loc><lastmod>${config.legalUpdated}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /s/\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`);

  // Every internal link and asset must exist in the build.
  for (const page of pages) {
    const out = page.path === '404' ? join(dist, '404.html') : join(dist, page.path, 'index.html'), html = readFileSync(out, 'utf8');
    for (const [, ref] of html.matchAll(/(?:href|src|poster|data-src)="(\/[^"#?]*)/g)) {
      if (ref.startsWith('/api/') || ref.startsWith('/s/')) continue;
      const target = ref.endsWith('/') ? join(dist, ref, 'index.html') : join(dist, ref);
      if (!existsSync(target)) warnings.push(`${page.file}: bağlantı bulunamadı: ${ref}`);
    }
  }
  let bytes = 0, files = 0;
  const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else { bytes += statSync(p).size; files++; } } };
  walk(dist);
  if (!o.quiet) {
    console.log(`Web sitesi derlendi: ${relative(ROOT, dist)} · ${pages.length} sayfa · ${files} dosya · ${(bytes / 1048576).toFixed(1)} MB`);
    for (const w of warnings) console.warn(`  Uyarı: ${w}`);
  }
  return { pages: pages.length, warnings, bytes, files };
}

function parsePage(file: string, text: string): PageMeta {
  const m = text.match(/^<!--page\s*\n([\s\S]*?)-->\s*\n/);
  if (!m) throw new Error(`${file}: en üstte <!--page … --> bloğu yok.`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  if (!meta.path || !meta.title || !meta.description) throw new Error(`${file}: path, title ve description gerekli.`);
  return { path: meta.path, title: meta.title, description: meta.description, nav: meta.nav, robots: meta.robots, file, body: text.slice(m[0].length) };
}

/** The Open Graph picture (1200 × 630): the green Mola panel, the promise and the guest menu on a phone. */
async function ogImage(out: string) {
  const W = 1200, H = 630;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><radialGradient id="g" cx="85%" cy="0%" r="110%"><stop offset="0" stop-color="#2f6650"/><stop offset=".5" stop-color="#234c3e"/><stop offset="1" stop-color="#163328"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <circle cx="1080" cy="40" r="210" fill="none" stroke="#ffffff" stroke-opacity=".12"/>
    <g transform="translate(80 92)"><rect width="64" height="64" rx="16" fill="#f3ebdd"/><g transform="translate(13 13) scale(1.6)" fill="none" stroke="#234c3e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v2"/><path d="M14 2v2"/><path d="M6 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/></g></g>
    <text x="164" y="140" font-family="Georgia, 'Times New Roman', serif" font-size="54" fill="#ffffff">mola<tspan fill="#d9926f">.</tspan></text>
    <text x="80" y="268" font-family="Georgia, 'Times New Roman', serif" font-size="58" fill="#ffffff">Kafenize güzel</text>
    <text x="80" y="336" font-family="Georgia, 'Times New Roman', serif" font-size="58" fill="#ffffff">bir mola verin.</text>
    <text x="80" y="408" font-family="Segoe UI, Arial, sans-serif" font-size="27" fill="#c9dccf">Adisyon ve QR menü: masadan mutfağa, kasadan rapora.</text>
    <text x="80" y="520" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="700" fill="#e9f1ea" letter-spacing="1">İNTERNET KESİLSE DE ÇALIŞIR · VERİ İŞLETMEDE</text>
    <text x="80" y="562" font-family="Segoe UI, Arial, sans-serif" font-size="22" fill="#8fb09c">molayazilim.com.tr</text>
  </svg>`;
  const layers: { input: Buffer; left: number; top: number }[] = [];
  const shotFile = join(SRC, 'assets', 'img', 'ekran-menu.webp');
  if (existsSync(shotFile)) {
    const pw = 270, ph = 560, r = 34;
    const screen = await sharp(shotFile).resize(pw - 20, ph - 20, { fit: 'cover', position: 'top' }).composite([{ input: Buffer.from(`<svg width="${pw - 20}" height="${ph - 20}"><rect width="${pw - 20}" height="${ph - 20}" rx="${r - 8}" fill="#fff"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
    const frame = Buffer.from(`<svg width="${pw}" height="${ph}"><rect width="${pw}" height="${ph}" rx="${r}" fill="#1c2721"/></svg>`);
    layers.push({ input: frame, left: 860, top: 50 }, { input: screen, left: 870, top: 60 });
  }
  await sharp(Buffer.from(svg)).composite(layers).png({ compressionLevel: 9 }).toFile(out);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSite().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
