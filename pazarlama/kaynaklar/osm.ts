import type { Aday } from '../tipler.js';
import { mesafe, sosyalEtiket, turBul, webiAyir } from '../yardimci.js';
import { onbellekOku, onbellekYaz } from '../depo.js';

/*
 * OpenStreetMap (Overpass API, ücretsiz). Kullanım kuralına uygun: tek sorgu, kendini tanıtan User-Agent, sonuç 24 saat
 * önbellekte. Elazığ il sınırı (admin_level 4) içindeki ilçeler (admin_level 6) tek tek dolaşılır, böylece her işletmenin
 * ilçesi bilinir. Mahalle: adreste yazıyorsa o; yoksa en yakın mahalle noktası ("yaklaşık").
 */

export const KULLANICI_AJANI = 'MolaPazarlama/0.1 (Elazig isletme listesi; destek@molayazilim.com.tr)';
export const OVERPASS_SUNUCULARI = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const ISLETME = `nwr["amenity"~"^(cafe|restaurant|fast_food|ice_cream|bar|pub|biergarten)$"]["name"](area.a);
    nwr["shop"~"^(pastry|confectionery|bakery)$"]["name"](area.a);`;

/**
 * Tek sorgu: il (ISO kodu TR-23, adı OSM'de "Elâzığ") → ilçeler → her ilçede işletmeler, mahalle noktaları ve mahalle
 * sınırları; her mahalle sınırının içindeki işletmelerin yalnızca kimlikleri. Böylece mahalle tahmin değil, sınırdan gelir.
 */
export function overpassSorgusu(kapsam: 'merkez' | 'il'): string {
  const filtre = kapsam === 'merkez' ? '["name"~"Merkez"]' : '';
  return `[out:json][timeout:180];
area["ISO3166-2"="TR-23"]["admin_level"="4"]->.il;
rel(area.il)["admin_level"="6"]["boundary"="administrative"]${filtre}->.ilceler;
foreach.ilceler->.d(
  .d out tags;
  .d map_to_area->.a;
  (
    ${ISLETME}
  )->.isl;
  .isl out center tags;
  nwr["place"~"^(neighbourhood|suburb|quarter)$"]["name"](area.a);
  out center tags;
  rel(area.a)["admin_level"="8"]["boundary"="administrative"]->.mahs;
  foreach.mahs->.m(
    .m out center tags;
    .m map_to_area->.ma;
    nwr.isl(area.ma);
    out ids;
  );
);`;
}

type Oge = { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

export function mahalleAdi(s: string): string {
  return (s || '').replace(/\s+(mahallesi|mahalle|mah\.?|mh\.?)$/i, '').trim();
}

/** Overpass cevabı → adaylar. Saf fonksiyon (testte örnek cevapla denenir). */
export function osmCevabiniIsle(cevap: { elements?: Oge[] }): { adaylar: Aday[]; ilceSayisi: number } {
  const adaylar: Aday[] = [];
  const kimlikle = new Map<string, Aday>();
  let ilce = '', ilceSayisi = 0, mahalle = '';
  let merkezler: { ad: string; lat: number; lon: number }[] = [];
  let ilcedekiler: Aday[] = [];
  /** Sınırla mahallesi bulunamayan (ya da mahalle sınırı OSM'de olmayan) işletmeye en yakın mahalle noktası, 1,5 km'ye kadar. */
  const ilceyiKapat = () => {
    for (const a of ilcedekiler) {
      if (a.mahalle || a.lat == null) continue;
      let enYakin: { ad: string; m: number } | null = null;
      for (const m of merkezler) {
        const d = mesafe({ lat: a.lat ?? null, lon: a.lon ?? null }, m);
        if (d < 1500 && (!enYakin || d < enYakin.m)) enYakin = { ad: m.ad, m: d };
      }
      if (enYakin) { a.mahalle = enYakin.ad; a.mahalleYaklasik = true; }
    }
    ilcedekiler = []; merkezler = [];
  };
  for (const e of cevap.elements ?? []) {
    const t = e.tags;
    const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
    const anahtar = `${e.type}/${e.id}`;
    if (!t) { // mahalle sınırı içindeki işletmenin kimliği
      const a = kimlikle.get(anahtar);
      if (a && mahalle && (!a.mahalle || a.mahalleYaklasik)) { a.mahalle = mahalle; a.mahalleYaklasik = false; }
      continue;
    }
    if (e.type === 'relation' && t.boundary === 'administrative' && t.admin_level === '6') {
      ilceyiKapat();
      ilce = (t.name ?? '').replace(/^Elâ?zığ\s+/i, '').trim() || t.name || '';
      ilceSayisi++; mahalle = '';
      continue;
    }
    if (e.type === 'relation' && t.boundary === 'administrative' && t.admin_level === '8') {
      mahalle = mahalleAdi(t.name ?? '');
      if (mahalle && lat != null && lon != null) merkezler.push({ ad: mahalle, lat, lon });
      continue;
    }
    if (t.place && !t.amenity && !t.shop) {
      if (lat != null && lon != null && t.name) merkezler.push({ ad: mahalleAdi(t.name), lat, lon });
      continue;
    }
    if (!t.name || (!t.amenity && !t.shop) || kimlikle.has(anahtar)) continue;
    const adresMahalle = mahalleAdi(t['addr:neighbourhood'] || t['addr:suburb'] || t['addr:quarter'] || '');
    const sokak = [t['addr:street'], t['addr:housenumber'] ? `No: ${t['addr:housenumber']}` : ''].filter(Boolean).join(' ');
    const adres = [t['addr:full'] || sokak, t['addr:place']].filter(Boolean).join(', ');
    const telefon = t.phone || t['contact:phone'] || t['contact:mobile'] || t.mobile || '';
    const web = t.website || t['contact:website'] || t.url || '';
    const tamlik = [telefon, web || t['contact:instagram'] || t['contact:facebook'] || t.instagram || t.facebook, t['addr:street'] || t['addr:full'], t.opening_hours, t.cuisine]
      .filter(Boolean).length / 5;
    const aday: Aday = webiAyir({
      kaynak: 'osm', ad: t.name.trim(), tur: turBul(t.name, t), ilce, mahalle: adresMahalle, mahalleYaklasik: false, adres,
      lat: lat ?? null, lon: lon ?? null, telefon: telefon.split(';')[0].trim(), web: web.split(';')[0].trim(),
      eposta: (t.email || t['contact:email'] || '').split(';')[0].trim().toLowerCase(),
      instagram: sosyalEtiket('instagram', t['contact:instagram'] || t.instagram || ''),
      facebook: sosyalEtiket('facebook', t['contact:facebook'] || t.facebook || ''),
      tiktok: sosyalEtiket('tiktok', t['contact:tiktok'] || t.tiktok || ''),
      x: sosyalEtiket('x', t['contact:twitter'] || t['contact:x'] || t.twitter || ''),
      whatsapp: (t['contact:whatsapp'] || '').replace(/\D/g, ''),
      saatler: !!t.opening_hours, osmTamlik: tamlik, osmId: anahtar, marka: t.brand || '',
    });
    adaylar.push(aday); kimlikle.set(anahtar, aday); ilcedekiler.push(aday);
  }
  ilceyiKapat();
  return { adaylar, ilceSayisi };
}

async function overpassIste(sorgu: string, haber: (s: string) => void): Promise<{ elements: Oge[] }> {
  let son: unknown;
  for (const [sira, sunucu] of OVERPASS_SUNUCULARI.entries()) {
    if (sira) { haber(`Sunucu yoğun, ${new URL(sunucu).hostname} deneniyor…`); await new Promise((r) => setTimeout(r, 10_000)); }
    try {
      const yanit = await fetch(sunucu, {
        method: 'POST', headers: { 'User-Agent': KULLANICI_AJANI, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ data: sorgu }), signal: AbortSignal.timeout(200_000),
      });
      const metin = await yanit.text();
      if (!yanit.ok) throw new Error(`Overpass ${yanit.status}`);
      return JSON.parse(metin) as { elements: Oge[] };
    } catch (e) { son = e; }
  }
  throw new Error(`OpenStreetMap sunucularına ulaşılamadı (${son instanceof Error ? son.message : String(son)}). Birkaç dakika sonra yeniden deneyin.`);
}

export async function osmGetir(kapsam: 'merkez' | 'il', yenile: boolean, haber: (s: string) => void): Promise<{ adaylar: Aday[]; ilceSayisi: number; onbellekten: boolean }> {
  const ad = `osm-${kapsam}.json`;
  const eski = yenile ? null : onbellekOku<{ elements: Oge[] }>(ad, 24);
  if (eski) { haber(`Önbellekten okundu (${new Date(eski.zaman).toLocaleString('tr-TR')}).`); return { ...osmCevabiniIsle(eski.veri), onbellekten: true }; }
  haber('OpenStreetMap\'e soruluyor (bir dakika sürebilir)…');
  const cevap = await overpassIste(overpassSorgusu(kapsam), haber);
  const sonuc = osmCevabiniIsle(cevap);
  if (!sonuc.ilceSayisi) throw new Error('OpenStreetMap\'te Elazığ ilçe sınırları bulunamadı; sorgu boş döndü.');
  onbellekYaz(ad, cevap);
  return { ...sonuc, onbellekten: false };
}
