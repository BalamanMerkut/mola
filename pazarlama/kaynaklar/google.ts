import type { Aday } from '../tipler.js';
import { googleTur, webiAyir } from '../yardimci.js';

/*
 * Google Places API (New), isteğe bağlı: yalnızca pazarlama/ayarlar.json'da anahtar varsa ve sahibi düğmeye basınca.
 * Text Search cevabı istenen alanları (alan maskesi) doğrudan getirdiği için ayrıca Place Details çağrılmaz: her arama
 * en fazla 3 sayfa (20'şer, toplam 60 sonuç) = en fazla 3 istek. Ücret Google'ın aylık ücretsiz kotasını aşınca başlar.
 */

const ADRES = 'https://places.googleapis.com/v1/places:searchText';
const ALANLAR = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.nationalPhoneNumber', 'places.websiteUri',
  'places.googleMapsUri', 'places.rating', 'places.userRatingCount', 'places.regularOpeningHours.weekdayDescriptions', 'places.types', 'places.businessStatus',
  'places.addressComponents', 'nextPageToken'].join(',');
export const SAYFA_SINIRI = 3;
/** Elazığ merkezi; arama bu çevreye yönlendirilir (50 km Google'ın üst sınırı). */
const MERKEZ = { latitude: 38.6748, longitude: 39.2225 };

export function istekTahmini(aramalar: string[]): number { return aramalar.length * SAYFA_SINIRI; }

type Yer = {
  id: string; displayName?: { text: string }; formattedAddress?: string; location?: { latitude: number; longitude: number };
  nationalPhoneNumber?: string; websiteUri?: string; googleMapsUri?: string; rating?: number; userRatingCount?: number;
  regularOpeningHours?: { weekdayDescriptions?: string[] }; types?: string[]; businessStatus?: string;
  addressComponents?: { longText: string; types: string[] }[];
};

export function googleYeriIsle(y: Yer, kapsam: 'merkez' | 'il'): Aday | null {
  const ad = y.displayName?.text?.trim();
  if (!ad || y.businessStatus === 'CLOSED_PERMANENTLY') return null;
  const parca = (tur: string) => y.addressComponents?.find((c) => c.types.includes(tur))?.longText ?? '';
  const il = parca('administrative_area_level_1');
  if (il && !/elaz/i.test(il)) return null; // başka ildeki sonuç
  const ilce = parca('administrative_area_level_2').replace(/^Elâ?zığ\s*/i, '') || '';
  if (kapsam === 'merkez' && ilce && ilce !== 'Merkez') return null;
  const mahalle = (parca('neighborhood') || parca('sublocality_level_1') || parca('sublocality')).replace(/\s+(Mahallesi|Mah\.?|Mh\.?)$/i, '');
  return webiAyir({
    kaynak: 'google', ad, tur: googleTur(ad, y.types), ilce: ilce || (kapsam === 'merkez' ? 'Merkez' : ''), mahalle, mahalleYaklasik: false,
    adres: y.formattedAddress ?? '', lat: y.location?.latitude ?? null, lon: y.location?.longitude ?? null,
    telefon: y.nationalPhoneNumber ?? '', web: y.websiteUri ?? '', googleMaps: y.googleMapsUri ?? '', googlePuan: y.rating ?? null,
    googleYorum: y.userRatingCount ?? null, saatler: !!y.regularOpeningHours?.weekdayDescriptions?.length, googleId: y.id,
  });
}

export async function googleGetir(anahtar: string, aramalar: string[], kapsam: 'merkez' | 'il', haber: (s: string) => void): Promise<{ adaylar: Aday[]; istek: number }> {
  const adaylar: Aday[] = [];
  let istek = 0;
  for (const [i, arama] of aramalar.entries()) {
    let sayfa: string | undefined;
    for (let s = 0; s < SAYFA_SINIRI; s++) {
      haber(`Google: "${arama}" (${i + 1}/${aramalar.length}), sayfa ${s + 1}`);
      const yanit = await fetch(ADRES, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': anahtar, 'X-Goog-FieldMask': ALANLAR },
        body: JSON.stringify({ textQuery: arama, languageCode: 'tr', regionCode: 'TR', pageSize: 20, pageToken: sayfa,
          locationBias: { circle: { center: MERKEZ, radius: kapsam === 'merkez' ? 15000 : 50000 } } }),
        signal: AbortSignal.timeout(30_000),
      });
      istek++;
      const veri = await yanit.json().catch(() => ({})) as { places?: Yer[]; nextPageToken?: string; error?: { message?: string } };
      if (!yanit.ok) throw new Error(`Google hata verdi (${yanit.status}): ${veri.error?.message ?? 'bilinmiyor'}. Anahtarı ve Places API (New) iznini kontrol edin.`);
      for (const y of veri.places ?? []) { const a = googleYeriIsle(y, kapsam); if (a) adaylar.push(a); }
      sayfa = veri.nextPageToken;
      if (!sayfa) break;
      await new Promise((r) => setTimeout(r, 1500)); // sonraki sayfa belirteci hemen geçerli olmayabilir
    }
  }
  return { adaylar, istek };
}
