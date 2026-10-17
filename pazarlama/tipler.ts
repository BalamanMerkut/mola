/*
 * Mola Pazarlama: Elazığ'daki kafe, restoran, pastane... listesi ve elle yazışma takibi. Mola uygulamasından ayrı, yalnızca
 * bu bilgisayarda çalışan küçük bir araç. Hiçbir zaman kendiliğinden mesaj atmaz; Instagram/Facebook taranmaz.
 */

export const DURUMLAR = ['bulundu', 'takip', 'mesaj', 'cevap', 'ziyaret', 'pilot', 'musteri', 'ilgilenmiyor'] as const;
export type Durum = typeof DURUMLAR[number];
export const DURUM_ADI: Record<Durum, string> = {
  bulundu: 'Bulundu', takip: 'Takip edildi', mesaj: 'Mesaj atıldı', cevap: 'Cevap verdi', ziyaret: 'Ziyaret/görüşme',
  pilot: 'Pilot', musteri: 'Müşteri', ilgilenmiyor: 'İlgilenmiyor',
};

export type Kaynak = 'osm' | 'google' | 'web' | 'elle';
export type SonGonderi = '' | 'hafta' | 'ay' | 'eski' | 'hic';
export type Menu = '' | 'yok' | 'kagit' | 'qr';

export interface Not { tarih: string; metin: string }

export interface Isletme {
  id: string;
  ad: string;
  tur: string;
  ilce: string;
  mahalle: string;
  /** Mahalle came from the nearest OSM place point, not from the address. */
  mahalleYaklasik: boolean;
  adres: string;
  lat: number | null;
  lon: number | null;
  telefon: string;
  web: string;
  eposta: string;
  /** Instagram kullanıcı adı, @ olmadan, küçük harf. */
  instagram: string;
  facebook: string;
  tiktok: string;
  x: string;
  whatsapp: string;
  googleMaps: string;
  googlePuan: number | null;
  googleYorum: number | null;
  /** Açılış saatleri biliniyor mu (OSM opening_hours veya Google). */
  saatler: boolean;
  /** 0–1: OSM kaydında telefon, web, adres, saat, mutfak bilgisinden kaçı var. */
  osmTamlik: number | null;
  osmId: string;
  googleId: string;
  /** OSM'de brand etiketi var (zincir işareti). */
  marka: string;
  /** null: otomatik (zincir listesinden), true/false: elle seçildi. */
  zincirElle: boolean | null;
  kaynaklar: Kaynak[];
  durum: Durum;
  notlar: Not[];
  sonrakiTakip: string;
  // Elle doldurulan "işine yatırım yapıyor mu" alanları (profil açıldığında birkaç saniyede).
  takipci: number | null;
  sonGonderi: SonGonderi;
  sonGonderiTarihi: string;
  kampanya: boolean;
  menu: Menu;
  /** Web sitesi en son ne zaman tarandı (ISO) ve kısa sonuç. */
  webTarandi: string;
  webSonuc: string;
  /** Elle değiştirilen alanlar: kaynaklar bunların üstüne yazmaz. */
  elleDegisen: string[];
  olusturma: string;
  guncelleme: string;
}

/** Kaynaklardan gelen ham kayıt (birleştirilmeden önce). */
export type Aday = Partial<Omit<Isletme, 'id' | 'kaynaklar' | 'notlar' | 'durum' | 'elleDegisen' | 'olusturma' | 'guncelleme'>> & { ad: string; kaynak: Kaynak };

export interface Oncelik {
  takipci: [number, number][];
  sonGonderi: Record<Exclude<SonGonderi, ''>, number>;
  kampanya: number;
  menu: Record<Exclude<Menu, ''>, number>;
  googlePuan: [number, number][];
  googleYorum: [number, number][];
  web: number;
  instagram: number;
  eposta: number;
  saatler: number;
  osmTamlik: number;
  zincirCarpani: number;
  ziyaretEsigi: number;
}

export interface Ayarlar {
  googleApiAnahtari: string;
  googleAramalari: string[];
  zincirler: string[];
  oncelik: Oncelik;
  kapsam: 'merkez' | 'il';
}
