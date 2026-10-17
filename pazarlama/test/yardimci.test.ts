import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adAnahtari, ayarlarBirlestir, ayniIsletme, birlestir, bosIsletme, csvHucre, csvYap, htmlTara, iletisimSayfasi, instagramAdi, oncelikDokumu,
  oncelikPuani, robotsIzinli, sadeYazi, sosyalBul, sosyalEtiket, telefonYerel, turBul, VARSAYILAN_ONCELIK, VARSAYILAN_ZINCIRLER, webiAyir, zincirMi,
} from '../yardimci.js';
import { googleYeriIsle, istekTahmini } from '../kaynaklar/google.js';
import { disAdresMi } from '../kaynaklar/web.js';
import type { Aday, Isletme } from '../tipler.js';

// Örnek adlar uydurmadır; ağ yok.

test('Türkçe sadeleştirme ve ad anahtarı (genel sözcükler atılır)', () => {
  assert.equal(sadeYazi('KAHVE DÜNYASI İzzetpaşa'), 'kahve dunyasi izzetpasa');
  assert.equal(sadeYazi('Çınar Çay Bahçesi'), 'cinar cay bahcesi');
  assert.equal(adAnahtari('Lale Cafe & Restaurant'), 'lale');
  assert.equal(adAnahtari('Lale Kafe'), 'lale');
  assert.equal(adAnahtari('Kafe'), 'kafe', 'yalnızca genel sözcükse ad olduğu gibi kalır');
});

test('Tekilleştirme: ad + 80 m, telefon/web/Instagram + 300 m, şubeler ayrı', () => {
  const a = { ad: 'Lale Cafe', lat: 38.6748, lon: 39.2225, telefon: '+90 424 111 22 33' };
  assert.equal(ayniIsletme(a, { ad: 'Lale Kafe & Restoran', lat: 38.6751, lon: 39.2227 }), true, 'aynı ad, ~40 m');
  assert.equal(ayniIsletme(a, { ad: 'Lale Cafe', lat: 38.6790, lon: 39.2225 }), false, 'aynı ad ama ~470 m: başka şube');
  assert.equal(ayniIsletme(a, { ad: 'Lale Pastanesi Bahçe', lat: 38.6749, lon: 39.2226 }), true, 'biri ötekini içeriyor');
  assert.equal(ayniIsletme(a, { ad: 'Gül Cafe', lat: 38.6749, lon: 39.2226 }), false, 'yan yana iki ayrı kafe');
  assert.equal(ayniIsletme(a, { ad: 'Lale Coffee House', lat: 38.6760, lon: 39.2230, telefon: '0424 111 2233' }), true, 'aynı telefon, ~140 m');
  assert.equal(ayniIsletme(a, { ad: 'Başka Ad', lat: 38.7000, lon: 39.2225, telefon: '04241112233' }), false, 'aynı telefon ama 2,8 km: zincirin başka şubesi');
  assert.equal(ayniIsletme({ ad: 'X', web: 'https://www.ornekkafe.com/' }, { ad: 'Y', web: 'http://ornekkafe.com' }), true, 'konum yok, aynı site');
  assert.equal(ayniIsletme({ ad: 'Mavi', instagram: 'mavikafe', lat: 38.67, lon: 39.22 }, { ad: 'Mavi Kahve Evi', instagram: 'mavikafe', lat: 38.6705, lon: 39.2203 }), true);
  assert.equal(ayniIsletme({ ad: 'A', osmId: 'node/1' }, { ad: 'B', osmId: 'node/1' }), true);
});

test('Birleştirme: yeni/güncellenen sayılır, elle değişen alana dokunulmaz, sosyal web adresi Instagram alanına taşınır', () => {
  let n = 0;
  const liste: Isletme[] = [];
  const osm: Aday[] = [{ kaynak: 'osm', ad: 'Lale Cafe', lat: 38.6748, lon: 39.2225, telefon: '+90 424 111 22 33', osmId: 'node/5', mahalle: 'Cumhuriyet', mahalleYaklasik: true }];
  assert.deepEqual(birlestir(liste, osm, () => `id${++n}`), { yeni: 1, guncellenen: 0, ayni: 0 });
  liste[0].eposta = 'elle@ornek.com.tr'; liste[0].elleDegisen.push('eposta');
  const google: Aday[] = [webiAyir({ kaynak: 'google', ad: 'Lale Kafe', lat: 38.6750, lon: 39.2226, web: 'https://www.instagram.com/lalekafe23/?igsh=abc', eposta: 'baska@x.com', googlePuan: 4.5, googleYorum: 210, mahalle: 'Cumhuriyet', mahalleYaklasik: false })];
  assert.deepEqual(birlestir(liste, google, () => `id${++n}`), { yeni: 0, guncellenen: 1, ayni: 0 });
  const k = liste[0];
  assert.equal(k.instagram, 'lalekafe23');
  assert.equal(k.web, '');
  assert.equal(k.eposta, 'elle@ornek.com.tr', 'elle yazılan e-posta korunur');
  assert.equal(k.googlePuan, 4.5);
  assert.equal(k.mahalleYaklasik, false, 'adresten gelen mahalle tahminin yerini alır');
  assert.deepEqual(k.kaynaklar, ['osm', 'google']);
  assert.deepEqual(birlestir(liste, google, () => `id${++n}`), { yeni: 0, guncellenen: 0, ayni: 1 });
});

test('Zincir tanıma: ad, bitişik yazım, OSM brand etiketi ve elle seçim', () => {
  const z = VARSAYILAN_ZINCIRLER;
  assert.equal(zincirMi({ ad: 'Kahve Dünyası Elazığ Park AVM' }, z), true);
  assert.equal(zincirMi({ ad: 'KahveDünyası' }, z), true);
  assert.equal(zincirMi({ ad: "McDonald's" }, z), true);
  assert.equal(zincirMi({ ad: 'Domino’s Pizza' }, z), true, 'kıvrık kesme işareti');
  assert.equal(zincirMi({ ad: 'Bizim Ev', marka: 'Simit Sarayı' }, z), true);
  assert.equal(zincirMi({ ad: 'Madoğlu Kebap' }, z), false, '"Mado" ad içinde parça olarak geçmesi yetmez');
  assert.equal(zincirMi({ ad: 'Harput Kahvecisi' }, z), false);
  assert.equal(zincirMi({ ad: 'Starbucks', zincirElle: false }, z), false);
  assert.equal(zincirMi({ ad: 'Yerel Döner', zincirElle: true }, z), true);
});

test('Sosyal adres tanıma ve sadeleştirme', () => {
  assert.deepEqual(sosyalBul('https://www.instagram.com/@lale.kafe/'), { tur: 'instagram', kimlik: 'lale.kafe', url: 'https://www.instagram.com/lale.kafe/' });
  assert.equal(sosyalBul('instagram.com/Lale_Kafe?igsh=MWx2bXh&utm_source=qr')?.kimlik, 'lale_kafe');
  assert.equal(sosyalBul('http://m.instagram.com/lalekafe')?.kimlik, 'lalekafe');
  assert.equal(sosyalBul('https://instagram.com/stories/lalekafe/123')?.kimlik, 'lalekafe');
  assert.equal(sosyalBul('https://www.instagram.com/p/C9xyz/'), null, 'gönderi adresi profil değil');
  assert.equal(sosyalBul('https://www.instagram.com/explore/tags/elazig/'), null);
  assert.equal(sosyalBul('https://www.facebook.com/LaleKafe23/?ref=page')?.kimlik, 'LaleKafe23');
  assert.equal(sosyalBul('https://m.facebook.com/profile.php?id=10006')?.url, 'https://www.facebook.com/profile.php?id=10006');
  assert.equal(sosyalBul('https://www.facebook.com/sharer/sharer.php?u=x'), null);
  assert.equal(sosyalBul('https://www.tiktok.com/@lalekafe?lang=tr')?.kimlik, 'lalekafe');
  assert.equal(sosyalBul('https://twitter.com/LaleKafe')?.url, 'https://x.com/LaleKafe');
  assert.equal(sosyalBul('https://x.com/intent/tweet?text=a'), null);
  assert.equal(sosyalBul('https://wa.me/905321112233')?.kimlik, '905321112233');
  assert.equal(sosyalBul('https://api.whatsapp.com/send?phone=905321112233')?.kimlik, '905321112233');
  assert.equal(sosyalBul('https://www.lalekafe.com.tr'), null);
  assert.equal(sosyalBul('javascript:alert(1)'), null);
  assert.equal(instagramAdi('@Lale.Kafe'), 'lale.kafe');
  assert.equal(instagramAdi('https://instagram.com/lalekafe/?hl=tr'), 'lalekafe');
  assert.equal(instagramAdi('bu bir ad değil'), '');
  assert.equal(sosyalEtiket('instagram', 'lalekafe'), 'lalekafe');
  assert.equal(sosyalEtiket('instagram', 'https://www.facebook.com/lale'), '', 'yanlış ağ');
  assert.equal(sosyalEtiket('facebook', 'https://facebook.com/lale.kafe'), 'lale.kafe');
});

test('HTML\'den e-posta ve sosyal bağlantı çıkarma', () => {
  const html = `<html><head><style>.a{background:url(logo@2x.png)}</style><script>var e="gizli@script.com"</script></head><body>
    <a href="mailto:Bilgi@LaleKafe.com.tr?subject=Merhaba">Yazın</a>
    <p>Rezervasyon: rezervasyon&#64;lalekafe.com.tr · eski: info [at] lalekafe.com.tr</p>
    <img src="ikon@3x.webp"> <p>Örnek: adiniz@example.com</p>
    <a href='https://www.instagram.com/lalekafe/?igsh=xx'>IG</a> <a href="https://instagram.com/p/abc">gönderi</a>
    <a href="https://www.facebook.com/lalekafe">FB</a> <a href=https://wa.me/905321112233>WA</a>
    <a href="/iletisim">İletişim</a></body></html>`;
  const s = htmlTara(html);
  assert.deepEqual(s.epostalar, ['bilgi@lalekafe.com.tr', 'rezervasyon@lalekafe.com.tr', 'info@lalekafe.com.tr']);
  assert.deepEqual(s.sosyal.map((x) => `${x.tur}:${x.kimlik}`), ['instagram:lalekafe', 'facebook:lalekafe', 'whatsapp:905321112233']);
  assert.equal(iletisimSayfasi(s.baglantilar, 'https://www.lalekafe.com.tr/'), 'https://www.lalekafe.com.tr/iletisim');
  assert.equal(iletisimSayfasi(['https://baska.com/contact'], 'https://lalekafe.com.tr/'), null, 'başka sitenin iletişim sayfasına gidilmez');
});

test('robots.txt', () => {
  const r = 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /yonetim\nAllow: /yonetim/iletisim\nDisallow: /*.pdf$\n';
  assert.equal(robotsIzinli(r, '/'), true);
  assert.equal(robotsIzinli(r, '/yonetim/x'), false);
  assert.equal(robotsIzinli(r, '/yonetim/iletisim'), true);
  assert.equal(robotsIzinli(r, '/menu.pdf'), false);
  assert.equal(robotsIzinli('User-agent: *\nDisallow: /', '/'), false);
  assert.equal(robotsIzinli('User-agent: *\nDisallow:', '/'), true);
  assert.equal(robotsIzinli('User-agent: MolaPazarlama\nDisallow: /\nUser-agent: *\nDisallow:', '/'), false);
  assert.equal(robotsIzinli('', '/iletisim'), true);
});

test('Yerel ağ adreslerine gidilmez', () => {
  assert.equal(disAdresMi(new URL('https://lalekafe.com.tr')), true);
  for (const u of ['http://localhost:3700/api/isletmeler', 'http://127.0.0.1/', 'http://192.168.1.10/', 'http://10.0.0.5', 'http://[::1]/', 'file:///c:/x', 'http://intranet/']) assert.equal(disAdresMi(new URL(u)), false, u);
});

test('CSV: Excel için BOM, noktalı virgül, tırnak ve formül koruması', () => {
  assert.equal(csvHucre('Lale; Kafe'), '"Lale; Kafe"');
  assert.equal(csvHucre('5" pasta'), '"5"" pasta"');
  assert.equal(csvHucre('satır\nalt'), '"satır\nalt"');
  assert.equal(csvHucre('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvHucre('@SUM(1)'), "'@SUM(1)");
  assert.equal(csvHucre(null), '');
  assert.equal(csvHucre(4.5), '4.5');
  const csv = csvYap(['Ad', 'Not'], [['Çınar', 'iyi']]);
  assert.ok(csv.startsWith('\uFEFFAd;Not\r\n'));
  assert.ok(csv.endsWith('Çınar;iyi\r\n'));
  assert.equal(telefonYerel('+90 424 218 00 00'), '0424 218 00 00');
  assert.equal(telefonYerel('05321112233'), '0532 111 22 33');
  assert.equal(telefonYerel('112'), '112');
});

test('Öncelik puanı: elle alanlar + otomatik işaretler, zincir çarpanı, ayarla değişir', () => {
  const k = bosIsletme('a', 'Lale Cafe');
  const o = VARSAYILAN_ONCELIK;
  assert.equal(oncelikPuani(k, o, false), 0);
  Object.assign(k, { instagram: 'lalekafe', web: 'https://lalekafe.com.tr', saatler: true, osmTamlik: 0.6 });
  assert.equal(oncelikPuani(k, o, false), 19, 'Instagram 8 + web 6 + saatler 3 + OSM 0,6×4');
  Object.assign(k, { takipci: 6200, sonGonderi: 'hafta', kampanya: true, menu: 'kagit', googlePuan: 4.4, googleYorum: 320 });
  const tam = oncelikPuani(k, o, false);
  assert.equal(tam, Math.round(20 + 15 + 10 + 10 + 6 + 7 + 8 + 6 + 3 + 2.4));
  assert.equal(oncelikPuani(k, o, true), Math.round(tam * 0.2));
  assert.equal(oncelikPuani({ ...k, web: 'https://instagram.com/lalekafe' }, o, false), tam - 6, 'Instagram adresi web sitesi sayılmaz');
  assert.equal(oncelikPuani({ ...k, sonGonderi: '', sonGonderiTarihi: '2026-10-01' }, o, false, new Date('2026-10-17T12:00:00Z')), tam - 15 + 10, 'tarih 16 gün önce: son 1 ay');
  const ayar = ayarlarBirlestir({ oncelik: { ...o, kampanya: 30 } });
  assert.equal(oncelikPuani(k, ayar.oncelik, false), Math.min(100, tam + 20));
  assert.ok(oncelikDokumu(k, o, false).parcalar.some((p) => p.ad === 'Instagram takipçi' && p.puan === 20));
});

test('Tür tahmini', () => {
  assert.equal(turBul('Çınar Çay Bahçesi', { amenity: 'cafe' }), 'Çay bahçesi');
  assert.equal(turBul('Saray Pastanesi', { amenity: 'cafe' }), 'Pastane / tatlıcı');
  assert.equal(turBul('Lale', { amenity: 'cafe' }), 'Kafe');
  assert.equal(turBul('Ev Yemekleri Lokantası', { amenity: 'restaurant' }), 'Lokanta');
  assert.equal(turBul('Köşe Fırın', { shop: 'bakery' }), 'Fırın');
});

test('Google yeri: il dışı ve kapalı yerler atılır, Instagram web adresi ayrılır, istek tahmini', () => {
  const temel = { id: 'g1', displayName: { text: 'Lale Kafe' }, location: { latitude: 38.67, longitude: 39.22 }, rating: 4.6, userRatingCount: 150,
    websiteUri: 'https://instagram.com/lalekafe', addressComponents: [{ longText: 'Elazığ', types: ['administrative_area_level_1'] }, { longText: 'Merkez', types: ['administrative_area_level_2'] }, { longText: 'Cumhuriyet Mahallesi', types: ['neighborhood'] }] };
  const a = googleYeriIsle(temel, 'merkez')!;
  assert.equal(a.instagram, 'lalekafe'); assert.equal(a.web, ''); assert.equal(a.mahalle, 'Cumhuriyet'); assert.equal(a.googleYorum, 150);
  assert.equal(googleYeriIsle({ ...temel, businessStatus: 'CLOSED_PERMANENTLY' }, 'merkez'), null);
  assert.equal(googleYeriIsle({ ...temel, addressComponents: [{ longText: 'Malatya', types: ['administrative_area_level_1'] }] }, 'il'), null);
  assert.equal(googleYeriIsle({ ...temel, addressComponents: [{ longText: 'Elazığ', types: ['administrative_area_level_1'] }, { longText: 'Palu', types: ['administrative_area_level_2'] }] }, 'merkez'), null);
  assert.equal(istekTahmini(['a', 'b', 'c']), 9);
});
