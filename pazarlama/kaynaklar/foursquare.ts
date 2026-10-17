import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Aday, FoursquareAyari } from '../tipler.js';
import { epostaGecerli, foursquareTur, sosyalEtiket, webiAyir } from '../yardimci.js';
import { VERI_KLASORU, guvenliYaz } from '../depo.js';

/*
 * Foursquare Places API (yeni, places-api.foursquare.com), isteğe bağlı: yalnızca pazarlama/ayarlar.json'da
 * "foursquare.anahtar" varsa ve sahibi düğmeye basınca. Kimlik: Service API Key, "Authorization: Bearer <anahtar>" ve
 * "X-Places-Api-Version" başlığı (https://docs.foursquare.com/fsq-developers-places/reference/authentication).
 * Varsayılan olarak yalnızca Pro alanlar istenir (aylık ücretsiz Pro kotası). Puan ve saatler Premium alandır: Premium'un
 * ücretsiz kotası yoktur, açılırsa her istek ücretlidir. Her istek bu bilgisayarda sayılır; aylık sınır aşılmaz.
 * Anahtar hiçbir mesaja, hataya ya da kayda yazılmaz; yalnızca places-api.foursquare.com'a gönderilir.
 */

export const ADRES = 'https://places-api.foursquare.com/places/search';
const IZINLI_HOST = 'places-api.foursquare.com';
export const API_SURUMU = '2025-06-17';
export const SAYFA_BOYUTU = 50;

/** Pro (ücretsiz kotaya giren) alanlar. */
export const PRO_ALANLAR = ['fsq_place_id', 'name', 'location', 'latitude', 'longitude', 'categories', 'chains', 'tel', 'website', 'email', 'social_media', 'date_closed'];
/** Premium alanlar: istenirse arama Premium sayılır (ücretli). */
export const PREMIUM_ALANLAR = ['rating', 'hours'];

/**
 * Kategoriler (üst kategori alt kategorileri de kapsar): Kafe, Kahve ve Çay Evi · Restoran (hızlı yemek, Türk mutfağı,
 * döner, kebap dahil) · Fırın · Tatlıcı (pastane, dondurma dahil) · Bar (nargile dahil) · Kahvaltı yeri.
 */
export const KATEGORILER: Record<string, string> = {
  '63be6904847c3692a84b9bb6': 'Cafe, Coffee, and Tea House',
  '4d4b7105d754a06374d81259': 'Restaurant',
  '4bf58dd8d48988d16a941735': 'Bakery',
  '4bf58dd8d48988d1d0941735': 'Dessert Shop',
  '4bf58dd8d48988d116941735': 'Bar',
  '4bf58dd8d48988d143941735': 'Breakfast Spot',
};

export type Merkez = { ad: string; lat: number; lon: number; yaricap: number };
/** Elazığ Merkez (şehir) ve ilçe merkezleri. "il" kapsamında Merkez en sona konur: kalan istek hakkı ona kalır. */
export const MERKEZ: Merkez = { ad: 'Merkez', lat: 38.6748, lon: 39.2225, yaricap: 12_000 };
export const ILCE_MERKEZLERI: Merkez[] = [
  { ad: 'Ağın', lat: 38.9406, lon: 38.7158, yaricap: 6000 },
  { ad: 'Alacakaya', lat: 38.4623, lon: 39.8587, yaricap: 6000 },
  { ad: 'Arıcak', lat: 38.5650, lon: 40.1360, yaricap: 6000 },
  { ad: 'Baskil', lat: 38.5694, lon: 38.8233, yaricap: 6000 },
  { ad: 'Karakoçan', lat: 38.9556, lon: 40.0397, yaricap: 8000 },
  { ad: 'Keban', lat: 38.7944, lon: 38.7408, yaricap: 6000 },
  { ad: 'Kovancılar', lat: 38.7194, lon: 39.8653, yaricap: 8000 },
  { ad: 'Maden', lat: 38.3925, lon: 39.6742, yaricap: 6000 },
  { ad: 'Palu', lat: 38.6908, lon: 39.9306, yaricap: 8000 },
  { ad: 'Sivrice', lat: 38.4467, lon: 39.3111, yaricap: 8000 },
];
const ILCELER = ['Merkez', ...ILCE_MERKEZLERI.map((m) => m.ad)];

export function merkezler(kapsam: 'merkez' | 'il'): Merkez[] {
  return kapsam === 'merkez' ? [MERKEZ] : [...ILCE_MERKEZLERI, MERKEZ];
}

export function alanlar(premium: boolean): string {
  return (premium ? [...PRO_ALANLAR, ...PREMIUM_ALANLAR] : PRO_ALANLAR).join(',');
}

export function aramaAdresi(m: Merkez, premium: boolean, cursor?: string): string {
  const u = new URL(ADRES);
  u.searchParams.set('ll', `${m.lat},${m.lon}`);
  u.searchParams.set('radius', String(m.yaricap));
  u.searchParams.set('fsq_category_ids', Object.keys(KATEGORILER).join(','));
  u.searchParams.set('fields', alanlar(premium));
  u.searchParams.set('limit', String(SAYFA_BOYUTU));
  if (cursor) u.searchParams.set('cursor', cursor);
  return u.href;
}

/**
 * Cevaptaki "link" başlığından sonraki sayfa: `<https://places-api.foursquare.com/places/search?...&cursor=X>; rel="next"`.
 * Yalnızca places-api.foursquare.com adresi kabul edilir (anahtar başka sunucuya gitmesin); yoksa null.
 */
export function sonrakiSayfa(link: string | null | undefined): { cursor: string } | null {
  const t = (link ?? '').trim();
  if (!t) return null;
  // Adreste virgül olabilir (ll=38.67,39.22): parçalar virgülden değil "<...>" bloklarından ayrılır.
  const parcalar = t.includes('<') ? [...t.matchAll(/<([^>]*)>([^<]*)/g)].map((m) => ({ url: m[1], ek: m[2] })) : [{ url: t, ek: '' }];
  const secilen = parcalar.find((p) => /rel\s*=\s*"?next"?/i.test(p.ek)) ?? (parcalar.length === 1 && !/rel\s*=/i.test(parcalar[0].ek) ? parcalar[0] : null);
  if (!secilen) return null;
  try {
    const u = new URL(secilen.url.trim());
    if (u.protocol !== 'https:' || u.hostname !== IZINLI_HOST) return null;
    const cursor = u.searchParams.get('cursor');
    return cursor ? { cursor } : null;
  } catch { return null; }
}

// ---------- Aylık sayaç ----------

export const SAYAC_DOSYASI = join(VERI_KLASORU, 'foursquare-sayac.json');
/** Foursquare faturası aylıktır; ay UTC takvimine göre sayılır. */
export const buAy = (simdi = new Date()) => simdi.toISOString().slice(0, 7);

export class AylikSayac {
  constructor(readonly dosya = SAYAC_DOSYASI, readonly simdi = () => new Date()) {}
  oku(): { ay: string; istek: number } {
    const ay = buAy(this.simdi());
    try {
      const v = JSON.parse(readFileSync(this.dosya, 'utf8')) as { ay?: string; istek?: number };
      return { ay, istek: v.ay === ay && Number.isFinite(v.istek) ? Number(v.istek) : 0 };
    } catch { return { ay, istek: 0 }; }
  }
  kalan(sinir: number): number { return Math.max(0, sinir - this.oku().istek); }
  /** İstekten ÖNCE yazılır: program yarıda kesilse de istek sayılmış olur. */
  artir(): number {
    const s = this.oku();
    s.istek++;
    guvenliYaz(this.dosya, JSON.stringify(s));
    return s.istek;
  }
}

/** Düğmenin üstünde yazan "en fazla N istek": çalıştırma sınırı ile bu ay kalan haktan küçüğü. */
export function istekTahmini(ayar: FoursquareAyari, sayac = new AylikSayac()): number {
  return Math.min(ayar.istekSiniri, sayac.kalan(ayar.aylikSinir));
}

// ---------- Cevap → aday ----------

type Yer = {
  fsq_place_id?: string; name?: string; latitude?: number; longitude?: number;
  location?: { address?: string; locality?: string; region?: string; postcode?: string; formatted_address?: string; neighborhood?: string[] | string; country?: string };
  categories?: { fsq_category_id?: string; name?: string }[]; chains?: { name?: string }[];
  tel?: string; website?: string; email?: string; social_media?: { instagram?: string; facebook_id?: string; twitter?: string };
  date_closed?: string; rating?: number; hours?: { display?: string; regular?: unknown[] };
};

/** "Hürriyet Cd. İzzetpaşa Mah. No:5" → "İzzetpaşa": Mah./Mahallesi/Mh. önündeki bir-iki sözcük. */
export function adrestenMahalle(adres: string): string {
  const s = adres || '';
  const m = /(?:^|[\s,])((?:[^\s,]+\s+)?[^\s,]+)\s+(?:Mahallesi|Mahalle|Mah\.?|Mh\.?)(?=[\s,]|$)/iu.exec(s);
  if (!m) return '';
  const sozler = m[1].split(/\s+/);
  // "Cd." "Sk." "No:5" gibi bir önceki adres parçası mahalle adına katılmaz.
  while (sozler.length > 1 && /[.:\d]/.test(sozler[0])) sozler.shift();
  return /[.:\d]/.test(sozler[sozler.length - 1]) ? '' : sozler.join(' ');
}

function ilceBul(loc: Yer['location']): string {
  const adaylar = [loc?.locality, ...(loc?.formatted_address ?? '').split(',')].map((x) => (x ?? '').trim()).filter(Boolean);
  for (const a of adaylar) {
    const sade = a.replace(/^\d{5}\s*/, '').replace(/^Elâ?zığ\s*\/?\s*/i, '').replace(/\s*\/\s*Elâ?zığ$/i, '').trim();
    const ilce = ILCELER.find((i) => i.toLocaleLowerCase('tr-TR') === sade.toLocaleLowerCase('tr-TR'));
    if (ilce) return ilce;
  }
  // Foursquare Merkez ilçedeki yerlere çoğunlukla yalnızca "Elazığ" yazar.
  return /^elâ?zığ$/i.test((loc?.locality ?? '').trim()) ? 'Merkez' : '';
}

export function foursquareYeriIsle(y: Yer, kapsam: 'merkez' | 'il'): Aday | null {
  const ad = y.name?.trim();
  if (!ad || !y.fsq_place_id || y.date_closed) return null; // kapanmış yer
  const loc = y.location ?? {};
  if (loc.region && !/el[aâ]z/i.test(loc.region)) return null; // başka ildeki sonuç
  if (loc.country && loc.country !== 'TR') return null;
  const ilce = ilceBul(loc);
  if (kapsam === 'merkez' && ilce && ilce !== 'Merkez') return null;
  const mahalleHam = Array.isArray(loc.neighborhood) ? loc.neighborhood[0] : loc.neighborhood;
  const mahalle = (mahalleHam ?? '').replace(/\s+(Mahallesi|Mah\.?|Mh\.?)$/i, '').trim() || adrestenMahalle(loc.address ?? loc.formatted_address ?? '');
  const eposta = (y.email ?? '').trim().toLowerCase();
  const sosyal = y.social_media ?? {};
  return webiAyir({
    kaynak: 'foursquare', ad, tur: foursquareTur(ad, (y.categories ?? []).map((c) => c.name ?? '')),
    ilce: ilce || (kapsam === 'merkez' ? 'Merkez' : ''), mahalle, mahalleYaklasik: false,
    adres: loc.formatted_address || loc.address || '', lat: y.latitude ?? null, lon: y.longitude ?? null,
    telefon: y.tel ?? '', web: y.website ?? '', eposta: epostaGecerli(eposta) ? eposta : '',
    instagram: sosyalEtiket('instagram', sosyal.instagram ?? ''),
    facebook: sosyalEtiket('facebook', sosyal.facebook_id ?? ''),
    x: sosyalEtiket('x', sosyal.twitter ?? ''),
    marka: y.chains?.[0]?.name?.trim() ?? '',
    fsqId: y.fsq_place_id,
    fsqPuan: typeof y.rating === 'number' && Number.isFinite(y.rating) ? y.rating : null,
    saatler: !!(y.hours?.display || y.hours?.regular?.length) || undefined,
  });
}

// ---------- Getir ----------

/** Metinde anahtar geçiyorsa gizler (hata mesajlarına sızmasın). */
export function anahtariGizle(metin: string, anahtar: string): string {
  return anahtar ? metin.split(anahtar).join('***') : metin;
}

export type Getirici = (url: string, istek: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers: { get(ad: string): string | null }; json(): Promise<unknown> }>;

export async function foursquareGetir(ayar: FoursquareAyari, kapsam: 'merkez' | 'il', haber: (s: string) => void,
  secenek: { getir?: Getirici; sayac?: AylikSayac; bekle?: number } = {}): Promise<{ adaylar: Aday[]; istek: number; kalan: number }> {
  const anahtar = ayar.anahtar;
  if (!anahtar) throw new Error('Foursquare anahtarı yok (pazarlama/ayarlar.json → "foursquare": { "anahtar": … }).');
  const getir = secenek.getir ?? (fetch as unknown as Getirici);
  const sayac = secenek.sayac ?? new AylikSayac();
  const butce = istekTahmini(ayar, sayac);
  if (butce <= 0) throw new Error(`Bu ayın Foursquare istek sınırı doldu (${ayar.aylikSinir}). Ay başında yeniden açılır; sınır ayarlar.json → "foursquare.aylikSinir".`);
  const adaylar: Aday[] = [];
  let istek = 0;
  const liste = merkezler(kapsam);
  try {
    for (const [i, m] of liste.entries()) {
      // Kalan hak kalan merkezlere bölünür; her merkez en az 1 istek alır (hak bittiyse atlanır).
      const pay = Math.max(1, Math.floor((butce - istek) / (liste.length - i)));
      let cursor: string | undefined;
      for (let s = 0; s < pay && istek < butce; s++) {
        if (sayac.kalan(ayar.aylikSinir) <= 0) { haber('Aylık sınıra ulaşıldı, duruldu.'); return { adaylar, istek, kalan: 0 }; }
        haber(`Foursquare: ${m.ad} (${i + 1}/${liste.length}), sayfa ${s + 1}`);
        sayac.artir();
        istek++;
        const yanit = await getir(aramaAdresi(m, ayar.premiumAlanlar, cursor), {
          headers: { Authorization: `Bearer ${anahtar}`, 'X-Places-Api-Version': API_SURUMU, Accept: 'application/json' },
          signal: AbortSignal.timeout(30_000),
        });
        const veri = await yanit.json().catch(() => ({})) as { results?: Yer[]; message?: string };
        if (!yanit.ok) {
          const ipucu = yanit.status === 401 || yanit.status === 403 ? ' Anahtarı kontrol edin (Service API Key olmalı).' : yanit.status === 429 ? ' Çok fazla istek; biraz sonra deneyin.' : '';
          throw new Error(`Foursquare hata verdi (${yanit.status}): ${String(veri.message ?? 'bilinmiyor').slice(0, 200)}.${ipucu}`);
        }
        for (const y of veri.results ?? []) { const a = foursquareYeriIsle(y, kapsam); if (a) adaylar.push(a); }
        const sonraki = sonrakiSayfa(yanit.headers.get('link'));
        if (!sonraki) break;
        cursor = sonraki.cursor;
        if (secenek.bekle !== 0) await new Promise((r) => setTimeout(r, secenek.bekle ?? 300));
      }
    }
  } catch (e) {
    // Hata mesajı arayüze ve komut penceresine gider: anahtar asla görünmesin.
    throw new Error(anahtariGizle(e instanceof Error ? e.message : String(e), anahtar));
  }
  return { adaylar, istek, kalan: sayac.kalan(ayar.aylikSinir) };
}
