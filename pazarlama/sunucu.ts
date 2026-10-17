import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Depo, KLASOR, VERI_DOSYASI, ayarlariOku, yeniId } from './depo.js';
import { DURUMLAR, DURUM_ADI, type Isletme } from './tipler.js';
import { TAKIPCI_ARALIKLARI, aramaBaglantilari, bosIsletme, csvYap, instagramAdi, oncelikDokumu, sosyalBul, sosyalEtiket, telefonYerel, zincirMi } from './yardimci.js';
import { foursquareTopla, googleTopla, osmTopla, sayilar, taranacakSiteler, webTopla, type Ozet } from './topla.js';
import { istekTahmini } from './kaynaklar/google.js';
import { AylikSayac, istekTahmini as fsqTahmin } from './kaynaklar/foursquare.js';

/*
 * Mola Pazarlama yerel sunucusu: yalnızca 127.0.0.1'de dinler, başka Host başlığıyla gelen isteği reddeder (DNS
 * yeniden bağlama), değişiklik isteklerinde JSON ve aynı köken ister (başka sitenin formu bir şey değiştiremez).
 */

const PORT = Number(process.env.PAZARLAMA_PORT || 3700);
const IZINLI_HOST = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ARAYUZ = join(KLASOR, 'arayuz');
const DOSYALAR: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/stil.css': ['stil.css', 'text/css; charset=utf-8'],
  '/uygulama.js': ['uygulama.js', 'text/javascript; charset=utf-8'],
};

const depo = new Depo();

type Is = { tur: string; basladi: string; bitti: string; mesajlar: string[]; ilerleme: number | null; ozet: (Ozet & Record<string, unknown>) | null; hata: string };
let is: Is | null = null;

function bugun(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date()); }

function gonder(res: ServerResponse, durum: number, govde: unknown, tur = 'application/json; charset=utf-8') {
  res.writeHead(durum, {
    'Content-Type': tur, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
  res.end(typeof govde === 'string' || Buffer.isBuffer(govde) ? govde : JSON.stringify(govde));
}

async function govdeOku(req: IncomingMessage): Promise<Record<string, unknown>> {
  let boyut = 0;
  const parcalar: Buffer[] = [];
  for await (const p of req) { boyut += (p as Buffer).length; if (boyut > 1_000_000) throw new HataKodu(413, 'İstek çok büyük.'); parcalar.push(p as Buffer); }
  if (!boyut) return {};
  try { const v = JSON.parse(Buffer.concat(parcalar).toString('utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { throw new HataKodu(400, 'JSON okunamadı.'); }
}

class HataKodu extends Error { constructor(readonly kod: number, mesaj: string) { super(mesaj); } }

function gorunum(k: Isletme, ayarlar = ayarlariOku()) {
  const zincir = zincirMi(k, ayarlar.zincirler);
  const dokum = oncelikDokumu(k, ayarlar.oncelik, zincir);
  return { ...k, zincir, oncelik: dokum.puan, oncelikParcalari: dokum.parcalar, baglantilar: aramaBaglantilari(k), telefonYerel: telefonYerel(k.telefon), webSosyal: !!(k.web && sosyalBul(k.web)) };
}

const METIN = ['ad', 'tur', 'ilce', 'mahalle', 'adres', 'telefon', 'web', 'eposta', 'googleMaps'] as const;
const SAYI = ['lat', 'lon', 'takipci', 'googlePuan', 'googleYorum'] as const;
const GUN = /^\d{4}-\d{2}-\d{2}$/;

/** Arayüzden gelen alanları doğrular ve kayda yazar. Kaynaklar elle değişen alanların üstüne bir daha yazmaz. */
function alanlariYaz(k: Isletme, v: Record<string, unknown>) {
  const elle = (alan: string) => { if (!k.elleDegisen.includes(alan)) k.elleDegisen.push(alan); };
  for (const alan of METIN) {
    if (!(alan in v)) continue;
    const s = String(v[alan] ?? '').trim().slice(0, 500);
    if (alan === 'ad' && !s) throw new HataKodu(400, 'İşletme adı boş olamaz.');
    if (alan === 'eposta' && s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HataKodu(400, 'E-posta adresi geçersiz görünüyor.');
    if ((alan === 'web' || alan === 'googleMaps') && s && !/^https?:\/\//i.test(s) && !/^[\w-]+(\.[\w-]+)+/.test(s)) throw new HataKodu(400, 'Adres http:// ya da https:// ile başlamalı.');
    k[alan] = alan === 'web' && s && !/^https?:\/\//i.test(s) ? `https://${s}` : alan === 'eposta' ? s.toLowerCase() : s;
    if (alan === 'mahalle') k.mahalleYaklasik = false;
    if (alan === 'web') { k.webTarandi = ''; k.webSonuc = ''; }
    elle(alan);
  }
  if ('instagram' in v) {
    const ham = String(v.instagram ?? '').trim();
    const ad = instagramAdi(ham);
    if (ham && !ad) throw new HataKodu(400, 'Instagram adresi tanınmadı. Profil adresini (instagram.com/...) ya da @kullanıcıadı yazın.');
    k.instagram = ad; elle('instagram');
  }
  for (const alan of ['facebook', 'tiktok', 'x'] as const) {
    if (!(alan in v)) continue;
    const ham = String(v[alan] ?? '').trim();
    const kimlik = sosyalEtiket(alan, ham);
    if (ham && !kimlik) throw new HataKodu(400, `${alan} adresi tanınmadı.`);
    k[alan] = kimlik; elle(alan);
  }
  if ('whatsapp' in v) { k.whatsapp = String(v.whatsapp ?? '').replace(/\D/g, '').slice(0, 15); elle('whatsapp'); }
  for (const alan of SAYI) {
    if (!(alan in v)) continue;
    const ham = v[alan];
    const n = ham === '' || ham == null ? null : Number(String(ham).replace(',', '.'));
    if (n !== null && !Number.isFinite(n)) throw new HataKodu(400, 'Sayı geçersiz.');
    k[alan] = alan === 'takipci' || alan === 'googleYorum' ? (n === null ? null : Math.max(0, Math.round(n))) : n;
    elle(alan);
  }
  if ('kampanya' in v) k.kampanya = !!v.kampanya;
  if ('saatler' in v) { k.saatler = !!v.saatler; elle('saatler'); }
  if ('sonGonderi' in v) { const s = String(v.sonGonderi ?? ''); if (!['', 'hafta', 'ay', 'eski', 'hic'].includes(s)) throw new HataKodu(400, 'Son gönderi seçimi geçersiz.'); k.sonGonderi = s as Isletme['sonGonderi']; if (s) k.sonGonderiTarihi = ''; }
  if ('sonGonderiTarihi' in v) { const s = String(v.sonGonderiTarihi ?? ''); if (s && !GUN.test(s)) throw new HataKodu(400, 'Tarih geçersiz.'); k.sonGonderiTarihi = s; if (s) k.sonGonderi = ''; }
  if ('menu' in v) { const s = String(v.menu ?? ''); if (!['', 'yok', 'kagit', 'qr'].includes(s)) throw new HataKodu(400, 'Menü seçimi geçersiz.'); k.menu = s as Isletme['menu']; }
  if ('zincirElle' in v) k.zincirElle = v.zincirElle === true ? true : v.zincirElle === false ? false : null;
  if ('sonrakiTakip' in v) { const s = String(v.sonrakiTakip ?? ''); if (s && !GUN.test(s)) throw new HataKodu(400, 'Takip tarihi geçersiz.'); k.sonrakiTakip = s; }
  if ('durum' in v) {
    const d = String(v.durum);
    if (!(DURUMLAR as readonly string[]).includes(d)) throw new HataKodu(400, 'Durum geçersiz.');
    if (d !== k.durum) { k.notlar.push({ tarih: new Date().toISOString(), metin: `Durum: ${DURUM_ADI[d as Isletme['durum']]}` }); k.durum = d as Isletme['durum']; }
  }
  k.guncelleme = new Date().toISOString();
}

function isBaslat(tur: string, calis: (haber: (m: string, ilerleme?: number) => void) => Promise<Ozet & Record<string, unknown>>) {
  if (is && !is.bitti) throw new HataKodu(409, 'Başka bir toplama sürüyor; bitmesini bekleyin.');
  const yeni: Is = { tur, basladi: new Date().toISOString(), bitti: '', mesajlar: [], ilerleme: null, ozet: null, hata: '' };
  is = yeni;
  const haber = (m: string, ilerleme?: number) => { yeni.mesajlar.push(m); if (yeni.mesajlar.length > 200) yeni.mesajlar.shift(); if (ilerleme != null) yeni.ilerleme = ilerleme; };
  calis(haber).then((o) => { yeni.ozet = o; yeni.ilerleme = 1; }, (e) => { yeni.hata = e instanceof Error ? e.message : String(e); })
    .finally(() => { yeni.bitti = new Date().toISOString(); });
  return yeni;
}

/** Anahtarın kendisi asla gönderilmez; yalnızca var/yok ve sayaç. */
function foursquareBilgisi(ayarlar = ayarlariOku()) {
  const f = ayarlar.foursquare, sayac = new AylikSayac(), s = sayac.oku();
  return { var: !!f.anahtar, istekTahmini: fsqTahmin(f, sayac), istekSiniri: f.istekSiniri, aylikSinir: f.aylikSinir, buAy: s.istek, ay: s.ay, kalan: sayac.kalan(f.aylikSinir), premium: f.premiumAlanlar };
}

function durumBilgisi() {
  const ayarlar = ayarlariOku();
  return {
    bugun: bugun(), veriDosyasi: VERI_DOSYASI, durumlar: DURUMLAR.map((d) => ({ kod: d, ad: DURUM_ADI[d] })), takipciAraliklari: TAKIPCI_ARALIKLARI,
    google: { var: !!ayarlar.googleApiAnahtari, aramalar: ayarlar.googleAramalari, istekTahmini: istekTahmini(ayarlar.googleAramalari) },
    foursquare: foursquareBilgisi(ayarlar),
    kapsam: ayarlar.kapsam, ziyaretEsigi: ayarlar.oncelik.ziyaretEsigi, sayilar: sayilar(depo, ayarlar), taranacakSite: taranacakSiteler(depo).length, is,
  };
}

const CSV_BASLIK = ['Ad', 'Tür', 'İlçe', 'Mahalle', 'Adres', 'Telefon', 'E-posta', 'Instagram', 'Facebook', 'TikTok', 'Web', 'Google puanı', 'Google yorum',
  'Foursquare puanı (/10)', 'Takipçi', 'Öncelik', 'Zincir', 'Durum', 'Sonraki takip', 'Son not', 'Kaynaklar', 'Enlem', 'Boylam'];
function csvSatiri(k: ReturnType<typeof gorunum>) {
  const son = k.notlar[k.notlar.length - 1];
  return [k.ad, k.tur, k.ilce, k.mahalle, k.adres, telefonYerel(k.telefon), k.eposta, k.instagram ? `https://www.instagram.com/${k.instagram}/` : '',
    k.facebook, k.tiktok, k.web, k.googlePuan ?? '', k.googleYorum ?? '', k.fsqPuan ?? '', k.takipci ?? '', k.oncelik, k.zincir ? 'evet' : '', DURUM_ADI[k.durum],
    k.sonrakiTakip, son ? `${son.tarih.slice(0, 10)} ${son.metin}` : '', k.kaynaklar.join(' '), k.lat ?? '', k.lon ?? ''];
}

async function yonlendir(req: IncomingMessage, res: ServerResponse) {
  const host = (req.headers.host ?? '').toLowerCase();
  if (!IZINLI_HOST.has(host)) return gonder(res, 421, { hata: 'Bu araç yalnızca bu bilgisayardan açılır.' });
  const url = new URL(req.url ?? '/', `http://${host}`);
  const yol = url.pathname, yontem = req.method ?? 'GET';
  if (yontem !== 'GET' && yontem !== 'HEAD') {
    const koken = req.headers.origin;
    if (koken && !IZINLI_HOST.has(koken.replace(/^http:\/\//, '').toLowerCase())) return gonder(res, 403, { hata: 'Başka siteden gelen istek reddedildi.' });
    if (!/^application\/json/i.test(req.headers['content-type'] ?? '')) return gonder(res, 415, { hata: 'JSON bekleniyor.' });
  }
  if (yontem === 'GET' && DOSYALAR[yol]) {
    const [ad, tur] = DOSYALAR[yol];
    return gonder(res, 200, readFileSync(join(ARAYUZ, ad)), tur);
  }
  if (yol === '/api/durum' && yontem === 'GET') return gonder(res, 200, durumBilgisi());
  if (yol === '/api/isletmeler' && yontem === 'GET') { const a = ayarlariOku(); return gonder(res, 200, { bugun: bugun(), isletmeler: depo.isletmeler.map((k) => gorunum(k, a)) }); }
  if (yol === '/api/isletmeler' && yontem === 'POST') {
    const v = await govdeOku(req);
    const k = bosIsletme(yeniId(), String(v.ad ?? '').trim());
    alanlariYaz(k, { ...v, ad: v.ad ?? '' });
    k.kaynaklar = ['elle'];
    depo.isletmeler.push(k); depo.kaydet();
    return gonder(res, 201, gorunum(k));
  }
  const m = /^\/api\/isletmeler\/([0-9a-f]{12})(?:\/notlar(?:\/(\d+))?)?$/.exec(yol);
  if (m) {
    const k = depo.bul(m[1]);
    if (!k) return gonder(res, 404, { hata: 'Kayıt bulunamadı.' });
    const notYolu = yol.includes('/notlar');
    if (!notYolu && yontem === 'GET') return gonder(res, 200, gorunum(k));
    if (!notYolu && yontem === 'PATCH') { alanlariYaz(k, await govdeOku(req)); depo.kaydet(); return gonder(res, 200, gorunum(k)); }
    if (!notYolu && yontem === 'DELETE') { depo.isletmeler = depo.isletmeler.filter((x) => x !== k); depo.kaydet(); return gonder(res, 200, { tamam: true }); }
    if (notYolu && m[2] === undefined && yontem === 'POST') {
      const v = await govdeOku(req);
      const metin = String(v.metin ?? '').trim().slice(0, 4000);
      if (!metin) throw new HataKodu(400, 'Not boş.');
      k.notlar.push({ tarih: new Date().toISOString(), metin }); k.guncelleme = new Date().toISOString(); depo.kaydet();
      return gonder(res, 200, gorunum(k));
    }
    if (notYolu && m[2] !== undefined && yontem === 'DELETE') {
      const sira = Number(m[2]);
      if (sira >= k.notlar.length) return gonder(res, 404, { hata: 'Not bulunamadı.' });
      k.notlar.splice(sira, 1); depo.kaydet();
      return gonder(res, 200, gorunum(k));
    }
  }
  if (yol === '/api/topla/osm' && yontem === 'POST') {
    const v = await govdeOku(req);
    const kapsam = v.kapsam === 'il' ? 'il' : 'merkez';
    return gonder(res, 202, isBaslat('osm', (h) => osmTopla(depo, kapsam, !!v.yenile, h)));
  }
  if (yol === '/api/topla/google' && yontem === 'POST') {
    const v = await govdeOku(req);
    const ayarlar = ayarlariOku();
    if (!ayarlar.googleApiAnahtari) throw new HataKodu(400, 'Google anahtarı yok.');
    if (v.onay !== true) throw new HataKodu(400, 'Önce ücret notunu onaylayın.');
    return gonder(res, 202, isBaslat('google', (h) => googleTopla(depo, ayarlar, v.kapsam === 'il' ? 'il' : 'merkez', h)));
  }
  if (yol === '/api/topla/foursquare' && yontem === 'POST') {
    const v = await govdeOku(req);
    const ayarlar = ayarlariOku();
    if (!ayarlar.foursquare.anahtar) throw new HataKodu(400, 'Foursquare anahtarı yok.');
    if (v.onay !== true) throw new HataKodu(400, 'Önce istek sınırı notunu onaylayın.');
    if (foursquareBilgisi(ayarlar).kalan <= 0) throw new HataKodu(400, `Bu ayın Foursquare istek sınırı doldu (${ayarlar.foursquare.aylikSinir}).`);
    return gonder(res, 202, isBaslat('foursquare', (h) => foursquareTopla(depo, ayarlar, v.kapsam === 'il' ? 'il' : 'merkez', h)));
  }
  if (yol === '/api/topla/web' && yontem === 'POST') {
    const v = await govdeOku(req);
    const sinir = Math.min(500, Math.max(1, Number(v.sinir) || 30));
    return gonder(res, 202, isBaslat('web', (h) => webTopla(depo, sinir, h)));
  }
  if (yol === '/api/is' && yontem === 'GET') return gonder(res, 200, { is });
  if (yol === '/api/disa-aktar' && yontem === 'POST') {
    const v = await govdeOku(req);
    const ids = Array.isArray(v.ids) ? new Set(v.ids.map(String)) : null;
    const a = ayarlariOku();
    const satirlar = depo.isletmeler.filter((k) => !ids || ids.has(k.id)).map((k) => csvSatiri(gorunum(k, a)));
    return gonder(res, 200, csvYap(CSV_BASLIK, satirlar), 'text/csv; charset=utf-8');
  }
  gonder(res, 404, { hata: 'Bulunamadı.' });
}

const sunucu = createServer((req, res) => {
  yonlendir(req, res).catch((e) => {
    if (e instanceof HataKodu) return gonder(res, e.kod, { hata: e.message });
    console.error(e);
    gonder(res, 500, { hata: 'Beklenmeyen bir hata oldu; ayrıntı komut penceresinde.' });
  });
});

sunucu.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `${PORT} numaralı kapı kullanımda: Mola Pazarlama zaten açık olabilir (http://localhost:${PORT}).` : e.message);
  process.exit(1);
});

sunucu.listen(PORT, '127.0.0.1', () => {
  const adres = `http://localhost:${PORT}`;
  console.log(`Mola Pazarlama açık: ${adres}  (kapatmak için Ctrl+C)`);
  console.log(`Veri dosyası: ${VERI_DOSYASI}`);
  if (process.argv.includes('--acma')) return;
  const [komut, arg] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', adres]] : process.platform === 'darwin' ? ['open', [adres]] : ['xdg-open', [adres]];
  try { spawn(komut as string, arg as string[], { stdio: 'ignore', detached: true }).unref(); } catch { /* tarayıcı açılamazsa adres yukarıda */ }
});
