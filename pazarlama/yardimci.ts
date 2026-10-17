import type { Aday, Ayarlar, Isletme, Oncelik } from './tipler.js';

/* Saf yardımcılar (ağ ve dosya yok): testler bunları doğrudan dener. */

// ---------- Ad ve eşleştirme ----------

const TR: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', i̇: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
/** "Kahve Dünyası" → "kahve dunyasi": küçük harf (Türkçe), aksansız, yalnızca harf/rakam ve tek boşluk. */
export function sadeYazi(s: string): string {
  return (s || '').toLocaleLowerCase('tr-TR').replace(/[çğıöşüâîû]|i̇/g, (c) => TR[c] ?? c)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' ve ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** İşletme türünü söyleyen genel sözcükler: eşleştirmede adın kendisi kalsın diye atılır. */
const GENEL = new Set(['cafe', 'kafe', 'caffe', 'cafeteria', 'kafeterya', 'coffee', 'kahve', 'kahvecisi', 'kahvesi', 'restaurant', 'restoran', 'restorant',
  'lokanta', 'lokantasi', 'lokantalari', 'pastane', 'pastanesi', 'pastaneleri', 'patisserie', 'tatlici', 'tatlicisi', 'tatli', 'tatlilari', 'firin', 'firini', 'unlu', 'mamulleri',
  'bistro', 'bar', 'pub', 'cay', 'bahcesi', 'evi', 've', 'the', 'house', 'kebap', 'kebab', 'salonu', 'nargile', 'ocakbasi', 'elazig', 'subesi', 'sube']);
export function adAnahtari(ad: string): string {
  const parcalar = sadeYazi(ad).split(' ').filter(Boolean);
  const kalan = parcalar.filter((p) => !GENEL.has(p));
  return (kalan.length ? kalan : parcalar).join(' ');
}

/** İki nokta arası metre (haversine). */
export function mesafe(a: { lat: number | null; lon: number | null }, b: { lat: number | null; lon: number | null }): number {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return Infinity;
  const r = 6_371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Telefonun son 10 hanesi (alan kodu + numara): "+90 424 218 00 00" ve "0424 2180000" aynı. */
export function telefonAnahtari(t: string): string {
  const d = (t || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

/** "+90 424 218 00 00" → "0424 218 00 00"; tanınmayan biçim olduğu gibi kalır. */
export function telefonYerel(t: string): string {
  const d = (t || '').replace(/\D/g, '');
  const on = d.length === 12 && d.startsWith('90') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d.length === 10 ? d : '';
  if (!on) return (t || '').trim();
  return `0${on.slice(0, 3)} ${on.slice(3, 6)} ${on.slice(6, 8)} ${on.slice(8, 10)}`;
}

export function webAnahtari(u: string): string {
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    return url.hostname.replace(/^www\./, '').toLowerCase() + url.pathname.replace(/\/+$/, '').toLowerCase();
  } catch { return ''; }
}

export const ESLESME_METRE = 80;
export const ORTAK_BILGI_METRE = 300;

/**
 * İki kayıt aynı işletme mi? (1) Adın ayırt edici kısmı aynı (ya da biri ötekini içeriyor) ve 80 m'den yakın; ya da
 * (2) aynı telefon, aynı web sitesi veya aynı Instagram ve 300 m'den yakın (ya da birinin konumu yok). Şubeli
 * işletmeler aynı telefonu/siteyi paylaşabildiği için (2) de mesafeye bakar.
 */
export function ayniIsletme(a: Partial<Isletme> & { ad: string }, b: Partial<Isletme> & { ad: string }): boolean {
  if (a.osmId && b.osmId && a.osmId === b.osmId) return true;
  if (a.googleId && b.googleId && a.googleId === b.googleId) return true;
  const m = mesafe({ lat: a.lat ?? null, lon: a.lon ?? null }, { lat: b.lat ?? null, lon: b.lon ?? null });
  const ka = adAnahtari(a.ad), kb = adAnahtari(b.ad);
  if (m < ESLESME_METRE && ka && kb) {
    if (ka === kb) return true;
    const [kisa, uzun] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
    if (kisa.length >= 4 && (` ${uzun} `).includes(` ${kisa} `)) return true;
  }
  const yakin = m < ORTAK_BILGI_METRE || m === Infinity;
  if (!yakin) return false;
  const ta = telefonAnahtari(a.telefon ?? ''), tb = telefonAnahtari(b.telefon ?? '');
  if (ta && ta === tb) return true;
  const wa = webAnahtari(a.web ?? ''), wb = webAnahtari(b.web ?? '');
  if (wa && wa === wb) return true;
  if (a.instagram && a.instagram === b.instagram) return true;
  // Konumu olmayan iki kayıt yalnızca ad ile eşleşmesin: ad + aynı ilçe yeter.
  if (m === Infinity && ka && ka === kb && (a.ilce ?? '') === (b.ilce ?? '')) return true;
  return false;
}

// ---------- Zincirler ----------

export const VARSAYILAN_ZINCIRLER = ['Starbucks', 'Kahve Dünyası', 'Simit Sarayı', 'Burger King', "McDonald's", "Domino's", 'Popeyes', 'KFC',
  'Little Caesars', 'Pizza Hut', 'Sbarro', 'Arby\'s', 'Caribou', 'Gloria Jean\'s', 'Espressolab', 'Tchibo', 'Mado', 'Özsüt', 'Baydöner',
  'Tavuk Dünyası', 'Komagene', 'Dürümcü Baba', 'Usta Dönerci', 'Köfteci Yusuf', 'Pidem', 'Simit Dünyası', 'Coffy', 'Kahve Diyarı',
  'Big Chefs', 'Midpoint', 'HD İskender', 'Bereket Döner', 'Cookshop', 'Dominos', 'Mc Donalds', 'Subway', "Wendy's", "Carl's Jr"];

export function zincirMi(i: { ad: string; marka?: string; zincirElle?: boolean | null }, zincirler: string[]): boolean {
  if (i.zincirElle === true || i.zincirElle === false) return i.zincirElle;
  const ad = ` ${sadeYazi(i.ad)} `;
  const marka = sadeYazi(i.marka ?? '');
  return zincirler.some((z) => {
    const k = sadeYazi(z);
    if (!k) return false;
    const bitisik = k.replace(/ /g, '');
    return ad.includes(` ${k} `) || ad.replace(/ /g, '').includes(bitisik) && bitisik.length >= 6 || (!!marka && (marka === k || marka.replace(/ /g, '') === bitisik));
  });
}

// ---------- Sosyal bağlantılar ----------

export type Sosyal = { tur: 'instagram' | 'facebook' | 'tiktok' | 'x' | 'whatsapp'; kimlik: string; url: string };

const IG_AYRILMIS = new Set(['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv', 'direct', 'about', 'developer', 'legal', 'web', 'tags', 'locations', 'share', 'challenge']);
const FB_AYRILMIS = new Set(['sharer', 'sharer.php', 'share.php', 'share', 'plugins', 'dialog', 'tr', 'login', 'login.php', 'help', 'policies', 'privacy', 'events', 'groups', 'watch', 'photo', 'photo.php', 'story.php', 'permalink.php', 'hashtag', 'search', 'home.php', 'l.php', 'tr_TR']);
const X_AYRILMIS = new Set(['intent', 'share', 'home', 'search', 'hashtag', 'i', 'login', 'privacy', 'tos']);

function urlCoz(s: string): URL | null {
  const t = (s || '').trim();
  if (!t) return null;
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`); } catch { return null; }
}

/** Bir adres sosyal ağ profili mi? instagram.com/@x, /x/, ?igsh=..., m.facebook.com/x, tiktok.com/@x, x.com/x, wa.me/90... */
export function sosyalBul(adres: string): Sosyal | null {
  const u = urlCoz(adres);
  if (!u || !/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|tr|l|business|web)\./, '');
  const parca = u.pathname.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  if (host === 'instagram.com' || host === 'instagr.am') {
    let ad = parca[0] ?? '';
    if (ad === 'stories' && parca[1]) ad = parca[1];
    ad = ad.replace(/^@/, '').toLowerCase();
    if (!ad || IG_AYRILMIS.has(ad) || !/^[a-z0-9._]{1,30}$/.test(ad)) return null;
    return { tur: 'instagram', kimlik: ad, url: `https://www.instagram.com/${ad}/` };
  }
  if (host === 'facebook.com' || host === 'fb.com' || host === 'fb.me') {
    if (parca[0] === 'profile.php') { const id = u.searchParams.get('id'); return id && /^\d+$/.test(id) ? { tur: 'facebook', kimlik: id, url: `https://www.facebook.com/profile.php?id=${id}` } : null; }
    let ad = parca[0] ?? '';
    if (ad === 'pages' && parca.length >= 2) ad = parca[parca.length - 1] && /^\d+$/.test(parca[parca.length - 1]) ? parca[parca.length - 1] : parca[1];
    if (ad === 'people' && parca[2]) ad = parca[2];
    if (!ad || FB_AYRILMIS.has(ad) || !/^[\p{L}\p{N}._-]{2,80}$/u.test(ad)) return null;
    return { tur: 'facebook', kimlik: ad, url: `https://www.facebook.com/${encodeURIComponent(ad)}` };
  }
  if (host === 'tiktok.com') {
    const ad = (parca[0] ?? '').startsWith('@') ? parca[0].slice(1).toLowerCase() : '';
    if (!ad || !/^[a-z0-9._]{2,24}$/.test(ad)) return null;
    return { tur: 'tiktok', kimlik: ad, url: `https://www.tiktok.com/@${ad}` };
  }
  if (host === 'x.com' || host === 'twitter.com') {
    const ad = (parca[0] ?? '').replace(/^@/, '');
    if (!ad || X_AYRILMIS.has(ad.toLowerCase()) || !/^[A-Za-z0-9_]{1,15}$/.test(ad)) return null;
    return { tur: 'x', kimlik: ad.toLowerCase(), url: `https://x.com/${ad}` };
  }
  if (host === 'wa.me' || host === 'api.whatsapp.com' || host === 'whatsapp.com') {
    const no = (host === 'wa.me' ? parca[0] ?? '' : u.searchParams.get('phone') ?? '').replace(/\D/g, '');
    if (no.length < 10) return null;
    return { tur: 'whatsapp', kimlik: no, url: `https://wa.me/${no}` };
  }
  return null;
}

/** Elle yazılan Instagram alanı: tam adres, "@ad" ya da yalnızca "ad" olabilir. Geçersizse ''. */
export function instagramAdi(girdi: string): string {
  const t = (girdi || '').trim();
  if (!t) return '';
  if (/instagram\.com|instagr\.am/i.test(t)) return sosyalBul(t)?.tur === 'instagram' ? sosyalBul(t)!.kimlik : '';
  const ad = t.replace(/^@/, '').toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(ad) && !IG_AYRILMIS.has(ad) ? ad : '';
}

/** OSM etiketindeki değer (adres, @ad ya da ad) → profil kimliği. */
export function sosyalEtiket(tur: Sosyal['tur'], deger: string): string {
  const v = (deger || '').split(';')[0].trim();
  if (!v) return '';
  const s = sosyalBul(v);
  if (s) return s.tur === tur ? s.kimlik : '';
  if (/[/.]\w+\//.test(v) || v.includes('://')) return '';
  const ad = v.replace(/^@/, '');
  if (tur === 'instagram') return instagramAdi(ad);
  if (tur === 'tiktok') return /^[a-z0-9._]{2,24}$/i.test(ad) ? ad.toLowerCase() : '';
  if (tur === 'x') return /^[A-Za-z0-9_]{1,15}$/.test(ad) ? ad.toLowerCase() : '';
  if (tur === 'facebook') return /^[\p{L}\p{N}._-]{2,80}$/u.test(ad) ? ad : '';
  return '';
}

export function sosyalUrl(tur: Sosyal['tur'], kimlik: string): string {
  if (!kimlik) return '';
  if (tur === 'instagram') return `https://www.instagram.com/${kimlik}/`;
  if (tur === 'facebook') return /^\d+$/.test(kimlik) ? `https://www.facebook.com/profile.php?id=${kimlik}` : `https://www.facebook.com/${encodeURIComponent(kimlik)}`;
  if (tur === 'tiktok') return `https://www.tiktok.com/@${kimlik}`;
  if (tur === 'x') return `https://x.com/${kimlik}`;
  return `https://wa.me/${kimlik}`;
}

// ---------- HTML'den e-posta ve bağlantı ----------

const RESIM = /\.(png|jpe?g|gif|webp|svg|avif|ico|css|js)$/i;
const SAHTE_ALAN = /(^|\.)(example\.(com|org)|domain\.com|sentry\.io|sentry-next\.wixpress\.com|wixpress\.com|wix\.com|email\.com|mail\.com|yourdomain\.com|sitename\.com|test\.com|godaddy\.com)$/i;

function htmlCoz(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}

export function epostaGecerli(e: string): boolean {
  const t = e.toLowerCase();
  if (t.length > 100 || RESIM.test(t)) return false;
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(t)) return false;
  const alan = t.split('@')[1];
  return !SAHTE_ALAN.test(alan) && !/^(adiniz|isim|name|your|ornek|example|kullanici|user)@/.test(t);
}

/** Sayfadaki e-postalar (mailto: önce) ve sosyal profiller. */
export function htmlTara(html: string): { epostalar: string[]; sosyal: Sosyal[]; baglantilar: string[] } {
  const epostalar: string[] = [];
  const ekle = (e: string) => { const t = e.trim().toLowerCase().replace(/^mailto:/, ''); if (epostaGecerli(t) && !epostalar.includes(t)) epostalar.push(t); };
  const baglantilar: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) baglantilar.push(htmlCoz(m[1] ?? m[2] ?? m[3] ?? '').trim());
  for (const b of baglantilar) if (/^mailto:/i.test(b)) { try { ekle(decodeURIComponent(b.slice(7).split('?')[0])); } catch { ekle(b.slice(7).split('?')[0]); } }
  // Görünür metin: etiketler ve script/style atılır; "info [at] site.com" gibi gizleme de çözülür.
  const metin = htmlCoz(html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s*[[(]\s*(?:at|et)\s*[\])]\s*/gi, '@').replace(/\s*[[(]\s*(?:dot|nokta)\s*[\])]\s*/gi, '.');
  for (const m of metin.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g)) ekle(m[0]);
  const sosyal: Sosyal[] = [];
  for (const b of baglantilar) {
    const s = sosyalBul(b);
    if (s && !sosyal.some((x) => x.tur === s.tur && x.kimlik === s.kimlik)) sosyal.push(s);
  }
  return { epostalar, sosyal, baglantilar };
}

/** Ana sayfadaki "İletişim" bağlantısı (aynı site içinde), yoksa null. */
export function iletisimSayfasi(baglantilar: string[], taban: string): string | null {
  let tabanUrl: URL;
  try { tabanUrl = new URL(taban); } catch { return null; }
  for (const b of baglantilar) {
    if (!/iletisim|iletişim|contact|bize-ulasin|bize-ulaşın|ulasim/i.test(b)) continue;
    try {
      const u = new URL(b, tabanUrl);
      if (/^https?:$/.test(u.protocol) && u.hostname.replace(/^www\./, '') === tabanUrl.hostname.replace(/^www\./, '')) { u.hash = ''; return u.href; }
    } catch { /* geç */ }
  }
  return null;
}

// ---------- robots.txt ----------

/** robots.txt bu yolu bizim için (User-agent: * ya da MolaPazarlama) yasaklıyor mu? Basit önek eşleşmesi, Allow önce gelir. */
export function robotsIzinli(robots: string, yol: string, ajan = 'molapazarlama'): boolean {
  type Grup = { ajanlar: string[]; kurallar: { izin: boolean; yol: string }[] };
  const gruplar: Grup[] = [];
  let g: Grup | null = null, kuralGeldi = false;
  for (const satir of robots.split(/\r?\n/)) {
    const t = satir.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(t);
    if (!m) continue;
    const ad = m[1].toLowerCase(), deger = m[2].trim();
    if (ad === 'user-agent') {
      if (!g || kuralGeldi) { g = { ajanlar: [], kurallar: [] }; gruplar.push(g); kuralGeldi = false; }
      g.ajanlar.push(deger.toLowerCase());
    } else if ((ad === 'disallow' || ad === 'allow') && g) {
      kuralGeldi = true;
      if (deger) g.kurallar.push({ izin: ad === 'allow', yol: deger });
    }
  }
  const bizim = gruplar.filter((x) => x.ajanlar.some((a) => a !== '*' && ajan.includes(a)));
  const secilen = bizim.length ? bizim : gruplar.filter((x) => x.ajanlar.includes('*'));
  let enUzun = -1, izin = true;
  for (const k of secilen.flatMap((x) => x.kurallar)) {
    const desen = k.yol.replace(/\$$/, '');
    const re = new RegExp('^' + desen.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (k.yol.endsWith('$') ? '$' : ''));
    if (re.test(yol) && (desen.length > enUzun || (desen.length === enUzun && k.izin))) { enUzun = desen.length; izin = k.izin; }
  }
  return izin;
}

// ---------- Tür ----------

/** OSM etiketinden ve addan kısa Türkçe tür. */
export function turBul(ad: string, etiket: { amenity?: string; shop?: string; cuisine?: string }): string {
  const a = ` ${sadeYazi(ad)} `;
  if (/ cay bahcesi | aile bahcesi | bahce /.test(a)) return 'Çay bahçesi';
  if (/ nargile | hookah /.test(a)) return 'Nargile kafe';
  if (/ pastane| pastanesi | patisserie | tatli| baklava| kunefe| dondurma| sutlu /.test(a) || etiket.shop === 'pastry' || etiket.shop === 'confectionery') return 'Pastane / tatlıcı';
  if (etiket.amenity === 'ice_cream') return 'Dondurmacı';
  if (etiket.shop === 'bakery' || / firin| unlu mamul/.test(a)) return 'Fırın';
  if (etiket.amenity === 'cafe') return 'Kafe';
  if (etiket.amenity === 'restaurant') return / lokanta/.test(a) ? 'Lokanta' : 'Restoran';
  if (etiket.amenity === 'fast_food') return 'Hızlı yemek';
  if (etiket.amenity === 'bar' || etiket.amenity === 'pub' || etiket.amenity === 'biergarten') return 'Bar / pub';
  if (/ kafe | cafe | coffee | kahve/.test(a)) return 'Kafe';
  if (/ restoran| restaurant| lokanta| kebap| ocakbasi/.test(a)) return 'Restoran';
  return 'Diğer';
}

/** Google "types" listesinden tür. */
export function googleTur(ad: string, types: string[] = []): string {
  const t = new Set(types);
  const etiket = t.has('cafe') || t.has('coffee_shop') ? { amenity: 'cafe' } : t.has('bakery') ? { shop: 'bakery' } : t.has('ice_cream_shop') ? { amenity: 'ice_cream' }
    : t.has('dessert_shop') || t.has('confectionery') ? { shop: 'pastry' } : t.has('bar') || t.has('pub') ? { amenity: 'bar' }
    : t.has('fast_food_restaurant') || t.has('hamburger_restaurant') || t.has('pizza_restaurant') ? { amenity: 'fast_food' } : t.has('restaurant') ? { amenity: 'restaurant' } : {};
  return turBul(ad, etiket);
}

// ---------- Öncelik puanı ----------

export const VARSAYILAN_ONCELIK: Oncelik = {
  takipci: [[20000, 25], [5000, 20], [1000, 12], [1, 5]],
  sonGonderi: { hafta: 15, ay: 10, eski: 3, hic: 0 },
  kampanya: 10,
  menu: { kagit: 10, yok: 6, qr: 3 },
  googlePuan: [[4.3, 6], [4.0, 4], [0.1, 1]],
  googleYorum: [[500, 10], [100, 7], [30, 4], [1, 1]],
  web: 6, instagram: 8, eposta: 3, saatler: 3, osmTamlik: 4,
  zincirCarpani: 0.2,
  ziyaretEsigi: 30,
};

function basamak(deger: number | null | undefined, basamaklar: [number, number][]): number {
  if (deger == null || !Number.isFinite(deger)) return 0;
  for (const [esik, puan] of [...basamaklar].sort((a, b) => b[0] - a[0])) if (deger >= esik) return puan;
  return 0;
}

/** "Son gönderi" tarihi verildiyse bugüne göre kova; yoksa elle seçilen kova. */
export function sonGonderiKovasi(i: Pick<Isletme, 'sonGonderi' | 'sonGonderiTarihi'>, bugun = new Date()): Isletme['sonGonderi'] {
  const t = Date.parse(i.sonGonderiTarihi || '');
  if (Number.isFinite(t)) {
    const gun = (bugun.getTime() - t) / 86_400_000;
    return gun <= 7 ? 'hafta' : gun <= 31 ? 'ay' : 'eski';
  }
  return i.sonGonderi;
}

/**
 * Öncelik 0–100: elle girilen "işine yatırım yapıyor" alanları (takipçi, son gönderi, kampanya, menü) + otomatik işaretler
 * (Google puanı/yorum sayısı, web sitesi, Instagram, e-posta, açılış saatleri, OSM kaydının dolu olması). Zincirler
 * zincirCarpani ile çarpılır (kararı merkez verir). Ağırlıklar ayarlar.json "oncelik" ile değiştirilebilir.
 */
export function oncelikDokumu(i: Isletme, o: Oncelik, zincir: boolean, bugun = new Date()): { puan: number; parcalar: { ad: string; puan: number }[] } {
  const kova = sonGonderiKovasi(i, bugun);
  const parcalar: { ad: string; puan: number }[] = [
    { ad: 'Instagram takipçi', puan: basamak(i.takipci, o.takipci) },
    { ad: 'Son gönderi', puan: kova ? o.sonGonderi[kova] ?? 0 : 0 },
    { ad: 'Kampanya/duyuru', puan: i.kampanya ? o.kampanya : 0 },
    { ad: 'Menü durumu', puan: i.menu ? o.menu[i.menu] ?? 0 : 0 },
    { ad: 'Google puanı', puan: basamak(i.googlePuan, o.googlePuan) },
    { ad: 'Google yorum sayısı', puan: basamak(i.googleYorum, o.googleYorum) },
    { ad: 'Web sitesi', puan: i.web && !sosyalBul(i.web) ? o.web : 0 },
    { ad: 'Instagram hesabı', puan: i.instagram ? o.instagram : 0 },
    { ad: 'E-posta', puan: i.eposta ? o.eposta : 0 },
    { ad: 'Açılış saatleri', puan: i.saatler ? o.saatler : 0 },
    { ad: 'OSM kaydı dolu', puan: Math.round((i.osmTamlik ?? 0) * o.osmTamlik * 10) / 10 },
  ];
  let p = parcalar.reduce((t, x) => t + x.puan, 0);
  if (zincir) p *= o.zincirCarpani;
  return { puan: Math.max(0, Math.min(100, Math.round(p))), parcalar };
}

export function oncelikPuani(i: Isletme, o: Oncelik, zincir: boolean, bugun = new Date()): number {
  return oncelikDokumu(i, o, zincir, bugun).puan;
}

/** Takipçi kısayol düğmeleri: aralığın alt ucuna yakın bir sayı kaydedilir. */
export const TAKIPCI_ARALIKLARI: { etiket: string; deger: number }[] = [
  { etiket: '<1K', deger: 500 }, { etiket: '1–5K', deger: 1000 }, { etiket: '5–20K', deger: 5000 }, { etiket: '20K+', deger: 20000 },
];

// ---------- Yardımcı arama bağlantıları ----------

export function aramaBaglantilari(i: Pick<Isletme, 'ad' | 'ilce' | 'mahalle' | 'googleMaps' | 'lat' | 'lon'>): { etiket: string; url: string }[] {
  const yer = [i.mahalle, i.ilce && i.ilce !== 'Merkez' ? i.ilce : '', 'Elazığ'].filter(Boolean).join(' ');
  const q = encodeURIComponent;
  const liste = [
    { etiket: 'Instagram\'da ara', url: `https://www.instagram.com/explore/search/keyword/?q=${q(i.ad)}` },
    { etiket: 'Google: Instagram', url: `https://www.google.com/search?q=${q(`"${i.ad}" Elazığ instagram`)}` },
    { etiket: 'Google Haritalar', url: i.googleMaps && /^https:\/\//.test(i.googleMaps) ? i.googleMaps : `https://www.google.com/maps/search/?api=1&query=${q(`${i.ad} ${yer}`)}` },
  ];
  if (i.lat != null && i.lon != null) liste.push({ etiket: 'OpenStreetMap', url: `https://www.openstreetmap.org/?mlat=${i.lat}&mlon=${i.lon}#map=19/${i.lat}/${i.lon}` });
  return liste;
}

// ---------- CSV ----------

/** Excel'e uygun hücre: ; " ve satır sonu varsa tırnak; = + - @ ile başlayan değer formül sayılmasın diye ' ile başlar. */
export function csvHucre(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvYap(basliklar: string[], satirlar: unknown[][]): string {
  return '﻿' + [basliklar, ...satirlar].map((r) => r.map(csvHucre).join(';')).join('\r\n') + '\r\n';
}

// ---------- Birleştirme ----------

/** Kaynaktan gelen adayı var olan kayda işler: elle değişen alanlara dokunmaz; boş alanları doldurur; Google puanı tazelenir. */
export function adayIsle(k: Isletme, a: Aday): string[] {
  const degisen: string[] = [];
  const tazelenen = new Set(['googlePuan', 'googleYorum', 'googleMaps', 'osmTamlik']);
  for (const [alan, deger] of Object.entries(a)) {
    if (alan === 'kaynak' || alan === 'mahalleYaklasik' || deger == null || deger === '' || (Array.isArray(deger) && !deger.length)) continue;
    if (alan === 'ad' && k.ad) continue;
    if (k.elleDegisen.includes(alan)) continue;
    const eski = (k as unknown as Record<string, unknown>)[alan];
    const bos = eski == null || eski === '' || eski === false;
    if (bos || (tazelenen.has(alan) && eski !== deger) || (alan === 'mahalle' && k.mahalleYaklasik && a.mahalleYaklasik === false)) {
      if (eski !== deger) {
        (k as unknown as Record<string, unknown>)[alan] = deger; degisen.push(alan);
        if (alan === 'mahalle') k.mahalleYaklasik = !!a.mahalleYaklasik;
      } else if (alan === 'mahalle' && k.mahalleYaklasik) { k.mahalleYaklasik = false; degisen.push('mahalleYaklasik'); }
    }
  }
  if (!k.kaynaklar.includes(a.kaynak)) { k.kaynaklar.push(a.kaynak); degisen.push('kaynaklar'); }
  return degisen;
}

export function bosIsletme(id: string, ad: string, simdi = new Date().toISOString()): Isletme {
  return {
    id, ad, tur: '', ilce: '', mahalle: '', mahalleYaklasik: false, adres: '', lat: null, lon: null, telefon: '', web: '', eposta: '',
    instagram: '', facebook: '', tiktok: '', x: '', whatsapp: '', googleMaps: '', googlePuan: null, googleYorum: null, saatler: false,
    osmTamlik: null, osmId: '', googleId: '', marka: '', zincirElle: null, kaynaklar: [], durum: 'bulundu', notlar: [], sonrakiTakip: '',
    takipci: null, sonGonderi: '', sonGonderiTarihi: '', kampanya: false, menu: '', webTarandi: '', webSonuc: '', elleDegisen: [],
    olusturma: simdi, guncelleme: simdi,
  };
}

/**
 * Adayları listeye ekler ya da eşleşen kayda işler. Aynı turda gelen iki aday da birbiriyle eşleşebilir.
 * Döner: yeni / güncellenen / değişmeyen sayıları.
 */
export function birlestir(liste: Isletme[], adaylar: Aday[], yeniId: () => string, simdi = new Date().toISOString()) {
  const ozet = { yeni: 0, guncellenen: 0, ayni: 0 };
  for (const a of adaylar) {
    const k = liste.find((x) => ayniIsletme(x, a as Partial<Isletme> & { ad: string }));
    if (k) {
      const d = adayIsle(k, a);
      if (d.length) { k.guncelleme = simdi; ozet.guncellenen++; } else ozet.ayni++;
    } else {
      const y = bosIsletme(yeniId(), a.ad, simdi);
      adayIsle(y, a);
      liste.push(y);
      ozet.yeni++;
    }
  }
  return ozet;
}

/** Bir sosyal adresi web alanından ilgili alana taşır (Google'da çoğu esnaf Instagram'ını web sitesi diye yazar). */
export function webiAyir(a: Aday): Aday {
  const s = a.web ? sosyalBul(a.web) : null;
  if (!s) return a;
  const yeni: Aday = { ...a, web: '' };
  if (s.tur === 'instagram') yeni.instagram ||= s.kimlik;
  else if (s.tur === 'facebook') yeni.facebook ||= s.kimlik;
  else if (s.tur === 'tiktok') yeni.tiktok ||= s.kimlik;
  else if (s.tur === 'x') yeni.x ||= s.kimlik;
  else yeni.whatsapp ||= s.kimlik;
  return yeni;
}

export function ayarlarBirlestir(ham: Partial<Ayarlar> | null | undefined): Ayarlar {
  const h = ham ?? {};
  return {
    googleApiAnahtari: typeof h.googleApiAnahtari === 'string' ? h.googleApiAnahtari.trim() : '',
    googleAramalari: Array.isArray(h.googleAramalari) && h.googleAramalari.length ? h.googleAramalari.map(String) : VARSAYILAN_ARAMALAR,
    zincirler: Array.isArray(h.zincirler) ? h.zincirler.map(String) : VARSAYILAN_ZINCIRLER,
    oncelik: { ...VARSAYILAN_ONCELIK, ...(h.oncelik ?? {}) },
    kapsam: h.kapsam === 'il' ? 'il' : 'merkez',
  };
}

export const VARSAYILAN_ARAMALAR = ['kafe Elazığ', 'kahve dükkanı Elazığ', 'restoran Elazığ', 'lokanta Elazığ', 'pastane Elazığ', 'tatlıcı Elazığ',
  'çay bahçesi Elazığ', 'nargile kafe Elazığ', 'kahvaltı salonu Elazığ', 'fast food Elazığ'];
