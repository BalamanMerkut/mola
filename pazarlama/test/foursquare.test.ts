import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AylikSayac, adrestenMahalle, anahtariGizle, aramaAdresi, buAy, foursquareGetir, foursquareYeriIsle, istekTahmini, MERKEZ, merkezler, sonrakiSayfa,
  type Getirici,
} from '../kaynaklar/foursquare.js';
import { birlestir, bosIsletme, foursquareAyari, foursquareTur, oncelikDokumu, VARSAYILAN_ONCELIK } from '../yardimci.js';
import type { Aday, FoursquareAyari, Isletme } from '../tipler.js';

// Uydurma Foursquare cevapları; ağ yok. Sayaç her testte geçici klasöre yazılır (.local/pazarlama'ya dokunulmaz).
const sayfa1 = JSON.parse(readFileSync(new URL('./ornekler/foursquare-sayfa1.json', import.meta.url), 'utf8'));
const sayfa2 = JSON.parse(readFileSync(new URL('./ornekler/foursquare-sayfa2.json', import.meta.url), 'utf8'));
const ANAHTAR = 'fsq3-GIZLI-test-anahtari-123';
const ayar = (ek: Partial<FoursquareAyari> = {}): FoursquareAyari => ({ ...foursquareAyari({ anahtar: ANAHTAR }), ...ek });
const geciciSayac = (simdi = () => new Date('2026-10-17T10:00:00Z')) => new AylikSayac(join(mkdtempSync(join(tmpdir(), 'fsq-')), 'sayac.json'), simdi);
const SONRAKI = '<https://places-api.foursquare.com/places/search?ll=38.6748,39.2225&radius=12000&limit=50&cursor=c2FmZQ>; rel="next"';

type Kayit = { url: string; headers: Record<string, string> };
function sahteGetirici(sayfalar: { govde: unknown; link?: string; durum?: number }[], kayit: Kayit[] = []): Getirici {
  let i = 0;
  return async (url, istek) => {
    kayit.push({ url, headers: istek.headers });
    const s = sayfalar[Math.min(i++, sayfalar.length - 1)];
    return { ok: (s.durum ?? 200) < 400, status: s.durum ?? 200, headers: { get: (ad: string) => (ad.toLowerCase() === 'link' ? s.link ?? null : null) }, json: async () => s.govde };
  };
}

test('Foursquare yeri → aday: iletişim, sosyal, tür, mahalle; kapalı, il dışı, adsız ve Merkez dışı atılır', () => {
  const adaylar = (sayfa1.results as unknown[]).map((y) => foursquareYeriIsle(y as never, 'merkez')).filter((a): a is Aday => !!a);
  assert.deepEqual(adaylar.map((a) => a.fsqId), ['fsq-lale', 'fsq-mavi', 'fsq-harput', 'fsq-cinar', 'fsq-star']);
  const [lale, mavi, harput, cinar, star] = adaylar;
  assert.equal(lale.kaynak, 'foursquare'); assert.equal(lale.tur, 'Kafe'); assert.equal(lale.ilce, 'Merkez'); assert.equal(lale.mahalle, 'Cumhuriyet');
  assert.equal(lale.telefon, '0424 111 22 33'); assert.equal(lale.web, 'https://www.lalekafe.com.tr'); assert.equal(lale.eposta, 'bilgi@lalekafe.com.tr');
  assert.equal(lale.instagram, 'lalekafe23'); assert.equal(lale.facebook, '100064'); assert.equal(lale.x, 'lalekafe');
  assert.equal(lale.adres, 'Gazi Cd. Cumhuriyet Mah. No:5, 23100 Elazığ'); assert.equal(lale.lat, 38.67485);
  assert.equal(lale.fsqPuan, null, 'Pro alanlarda puan yok');
  assert.equal(mavi.instagram, 'mavi.kahve', '"@Ad" biçimi'); assert.equal(mavi.mahalle, 'İzzetpaşa');
  assert.equal(harput.instagram, 'harput_firin', 'tam adres + ?igsh'); assert.equal(harput.tur, 'Fırın'); assert.equal(harput.mahalle, 'Sürsürü');
  assert.equal(cinar.instagram, 'cinarbahce', 'web alanındaki Instagram adresi taşındı'); assert.equal(cinar.web, ''); assert.equal(cinar.tur, 'Çay bahçesi');
  assert.equal(star.marka, 'Starbucks', 'chains → marka (zincir işareti)');
  const il = (sayfa1.results as unknown[]).map((y) => foursquareYeriIsle(y as never, 'il')).filter((a): a is Aday => !!a);
  const palu = il.find((a) => a.fsqId === 'fsq-palu')!;
  assert.equal(palu.ilce, 'Palu'); assert.equal(palu.tur, 'Hızlı yemek');
  assert.ok(!il.some((a) => a.fsqId === 'fsq-malatya' || a.fsqId === 'fsq-kapali'));
});

test('Instagram biçimleri, mahalle ayıklama ve kategori → tür', () => {
  const ig = (v: string) => foursquareYeriIsle({ fsq_place_id: 'x', name: 'X', social_media: { instagram: v } }, 'il')?.instagram;
  assert.equal(ig('lalekafe'), 'lalekafe');
  assert.equal(ig('@LaleKafe'), 'lalekafe');
  assert.equal(ig('instagram.com/lale.kafe'), 'lale.kafe');
  assert.equal(ig('https://instagram.com/@lale_kafe/'), 'lale_kafe');
  assert.equal(ig('https://www.facebook.com/lale'), '', 'başka ağın adresi Instagram sayılmaz');
  assert.equal(ig('bu bir ad değil'), '');
  assert.equal(adrestenMahalle('Hürriyet Cd. İzzetpaşa Mah. No:5'), 'İzzetpaşa');
  assert.equal(adrestenMahalle('Mustafa Paşa Mahallesi, Elazığ'), 'Mustafa Paşa');
  assert.equal(adrestenMahalle('Gazi Caddesi No:3'), '');
  assert.equal(foursquareTur('Keyif', ['Hookah Bar']), 'Nargile kafe');
  assert.equal(foursquareTur('Tadım', ['Dessert Shop']), 'Pastane / tatlıcı');
  assert.equal(foursquareTur('Usta', ['Fast Food Restaurant']), 'Hızlı yemek');
  assert.equal(foursquareTur('Ev Yemekleri Lokantası', ['Turkish Home Cooking Restaurant']), 'Lokanta');
  assert.equal(foursquareTur('Gece', ['Pub']), 'Bar / pub');
});

test('Sonraki sayfa: link başlığındaki cursor; virgüllü adres, başka sunucu ve eksik başlık', () => {
  assert.deepEqual(sonrakiSayfa(SONRAKI), { cursor: 'c2FmZQ' });
  assert.deepEqual(sonrakiSayfa('<https://places-api.foursquare.com/places/search?cursor=onceki>; rel="prev", <https://places-api.foursquare.com/places/search?cursor=sonra>; rel="next"'), { cursor: 'sonra' });
  assert.deepEqual(sonrakiSayfa('https://places-api.foursquare.com/places/search?cursor=duz'), { cursor: 'duz' }, 'yalnızca adres');
  assert.equal(sonrakiSayfa('<https://kotu.example.com/places/search?cursor=x>; rel="next"'), null, 'anahtar başka sunucuya gitmez');
  assert.equal(sonrakiSayfa('<http://places-api.foursquare.com/places/search?cursor=x>; rel="next"'), null, 'şifresiz bağlantı');
  assert.equal(sonrakiSayfa('<https://places-api.foursquare.com/places/search?cursor=x>; rel="prev"'), null);
  assert.equal(sonrakiSayfa(null), null);
  assert.equal(sonrakiSayfa(''), null);
  const u = new URL(aramaAdresi(MERKEZ, false, 'c2FmZQ'));
  assert.equal(u.searchParams.get('cursor'), 'c2FmZQ'); assert.equal(u.searchParams.get('limit'), '50'); assert.equal(u.searchParams.get('ll'), '38.6748,39.2225');
  assert.equal(merkezler('il').length, 11); assert.equal(merkezler('il').at(-1)!.ad, 'Merkez', 'kalan hak Merkez\'e kalsın');
});

test('Getir: sayfalar link ile izlenir, başlıklar doğru, yalnızca Pro alanlar, istekler sayılır', async () => {
  const kayit: Kayit[] = [];
  const sayac = geciciSayac();
  const mesajlar: string[] = [];
  const s = await foursquareGetir(ayar(), 'merkez', (m) => mesajlar.push(m), { getir: sahteGetirici([{ govde: sayfa1, link: SONRAKI }, { govde: sayfa2 }], kayit), sayac, bekle: 0 });
  assert.equal(s.istek, 2); assert.equal(kayit.length, 2);
  assert.equal(s.adaylar.length, 6, 'sayfa 1\'den 5 + sayfa 2\'den 1');
  assert.equal(new URL(kayit[0].url).searchParams.get('cursor'), null);
  assert.equal(new URL(kayit[1].url).searchParams.get('cursor'), 'c2FmZQ');
  assert.equal(kayit[0].headers.Authorization, `Bearer ${ANAHTAR}`);
  assert.equal(kayit[0].headers['X-Places-Api-Version'], '2025-06-17');
  assert.ok(kayit.every((k) => new URL(k.url).hostname === 'places-api.foursquare.com'));
  const alan = new URL(kayit[0].url).searchParams.get('fields')!.split(',');
  assert.ok(alan.includes('social_media') && alan.includes('email') && alan.includes('website'));
  assert.ok(!alan.includes('rating') && !alan.includes('hours') && !alan.includes('stats') && !alan.includes('popularity'), 'Premium alan istenmez');
  assert.equal(sayac.oku().istek, 2); assert.equal(s.kalan, 448);
  // Premium seçilirse puan ve saatler istenir ve gelir.
  const kayit2: Kayit[] = [];
  const p = await foursquareGetir(ayar({ premiumAlanlar: true }), 'merkez', () => {}, { getir: sahteGetirici([{ govde: sayfa2 }], kayit2), sayac: geciciSayac(), bekle: 0 });
  assert.ok(new URL(kayit2[0].url).searchParams.get('fields')!.split(',').includes('rating'));
  assert.equal(p.adaylar[0].fsqPuan, 8.6); assert.equal(p.adaylar[0].saatler, true); assert.equal(p.adaylar[0].tur, 'Pastane / tatlıcı');
});

test('Çalıştırma sınırı: link hep sonraki sayfayı gösterse de istekSiniri aşılmaz; il kapsamında hak merkezlere bölünür', async () => {
  const kayit: Kayit[] = [];
  const s = await foursquareGetir(ayar({ istekSiniri: 4 }), 'merkez', () => {}, { getir: sahteGetirici([{ govde: sayfa2, link: SONRAKI }], kayit), sayac: geciciSayac(), bekle: 0 });
  assert.equal(s.istek, 4); assert.equal(kayit.length, 4);
  const kayit2: Kayit[] = [];
  const il = await foursquareGetir(ayar({ istekSiniri: 30 }), 'il', () => {}, { getir: sahteGetirici([{ govde: sayfa2, link: SONRAKI }], kayit2), sayac: geciciSayac(), bekle: 0 });
  assert.equal(il.istek, 30);
  const lls = new Set(kayit2.map((k) => new URL(k.url).searchParams.get('ll')));
  assert.equal(lls.size, 11, 'her ilçe merkezine en az bir istek');
});

test('Aylık sınır: dolunca hiç istek atılmaz; çalışırken dolarsa durur; yeni ayda sıfırlanır', async () => {
  const sayac = geciciSayac();
  writeFileSync(sayac.dosya, JSON.stringify({ ay: '2026-10', istek: 450 }));
  assert.equal(istekTahmini(ayar(), sayac), 0);
  const kayit: Kayit[] = [];
  await assert.rejects(foursquareGetir(ayar(), 'merkez', () => {}, { getir: sahteGetirici([{ govde: sayfa1 }], kayit), sayac, bekle: 0 }), /istek sınırı doldu \(450\)/);
  assert.equal(kayit.length, 0, 'ağa hiç gidilmedi');
  // Ay değişince sayaç sıfırdan başlar.
  const kasim = new AylikSayac(sayac.dosya, () => new Date('2026-11-01T00:00:01Z'));
  assert.equal(kasim.oku().istek, 0); assert.equal(istekTahmini(ayar(), kasim), 30);
  // Sınıra 2 istek kala çalıştırma 2 istekte durur.
  const az = geciciSayac();
  writeFileSync(az.dosya, JSON.stringify({ ay: buAy(new Date('2026-10-17T10:00:00Z')), istek: 448 }));
  const kayit2: Kayit[] = [];
  const s = await foursquareGetir(ayar(), 'il', () => {}, { getir: sahteGetirici([{ govde: sayfa2, link: SONRAKI }], kayit2), sayac: az, bekle: 0 });
  assert.equal(s.istek, 2); assert.equal(kayit2.length, 2); assert.equal(az.oku().istek, 450); assert.equal(s.kalan, 0);
});

test('Anahtar hiçbir mesajda ve hatada görünmez', async () => {
  const mesajlar: string[] = [];
  const yanki = { message: `Invalid key ${ANAHTAR}` }; // sunucu anahtarı geri yazsa bile
  const hata = await foursquareGetir(ayar(), 'merkez', (m) => mesajlar.push(m), { getir: sahteGetirici([{ govde: yanki, durum: 401 }]), sayac: geciciSayac(), bekle: 0 })
    .then(() => null, (e: Error) => e);
  assert.ok(hata, 'hata bekleniyordu');
  assert.match(hata.message, /401/); assert.match(hata.message, /Service API Key/);
  assert.ok(!hata.message.includes(ANAHTAR), hata.message);
  assert.ok(!(hata.stack ?? '').includes(ANAHTAR));
  const agHatasi: Getirici = async (_url, istek) => { throw new Error(`bağlantı koptu: ${istek.headers.Authorization}`); };
  const h2 = await foursquareGetir(ayar(), 'merkez', (m) => mesajlar.push(m), { getir: agHatasi, sayac: geciciSayac(), bekle: 0 }).then(() => null, (e: Error) => e);
  assert.ok(h2 && !h2.message.includes(ANAHTAR) && h2.message.includes('***'), h2?.message);
  assert.ok(mesajlar.length && mesajlar.every((m) => !m.includes(ANAHTAR)));
  assert.equal(anahtariGizle(`a ${ANAHTAR} b ${ANAHTAR}`, ANAHTAR), 'a *** b ***');
  assert.equal(anahtariGizle('metin', ''), 'metin');
  await assert.rejects(foursquareGetir(ayar({ anahtar: '' }), 'merkez', () => {}, { sayac: geciciSayac() }), /anahtarı yok/);
});

test('Tekilleştirme: OSM kaydıyla aynı yer birleşir, elle değişen alan korunur, ikinci tur değişmez', () => {
  let n = 0;
  const liste: Isletme[] = [];
  birlestir(liste, [{ kaynak: 'osm', ad: 'Lale Cafe', lat: 38.6748, lon: 39.2225, telefon: '+90 424 111 22 33', osmId: 'node/1', mahalle: 'Cumhuriyet', mahalleYaklasik: true }], () => `id${++n}`);
  liste[0].web = 'https://elle.example.com.tr'; liste[0].elleDegisen.push('web');
  const lale = foursquareYeriIsle(sayfa1.results[0], 'merkez')!;
  assert.deepEqual(birlestir(liste, [lale], () => `id${++n}`), { yeni: 0, guncellenen: 1, ayni: 0 });
  const k = liste[0];
  assert.equal(liste.length, 1);
  assert.deepEqual(k.kaynaklar, ['osm', 'foursquare']);
  assert.equal(k.fsqId, 'fsq-lale'); assert.equal(k.instagram, 'lalekafe23'); assert.equal(k.eposta, 'bilgi@lalekafe.com.tr');
  assert.equal(k.ad, 'Lale Cafe', 'ad değişmez'); assert.equal(k.telefon, '+90 424 111 22 33', 'dolu alan değişmez');
  assert.equal(k.web, 'https://elle.example.com.tr', 'elle yazılan web korunur');
  assert.equal(k.mahalleYaklasik, false, 'adresten gelen mahalle tahminin yerini alır');
  assert.deepEqual(birlestir(liste, [lale], () => `id${++n}`), { yeni: 0, guncellenen: 0, ayni: 1 });
  // Aynı fsq_place_id, konum değişse de aynı kayıt.
  assert.deepEqual(birlestir(liste, [{ ...lale, ad: 'Lale Kafe & Bistro', lat: 38.70, lon: 39.30 }], () => `id${++n}`).yeni, 0);
});

test('Puan: Foursquare /10 → /5 (Google basamakları); Google puanı varsa o kullanılır; ayarlar varsayılanı', () => {
  const k = bosIsletme('a', 'Saray Pastanesi');
  const parca = (i: Isletme) => oncelikDokumu(i, VARSAYILAN_ONCELIK, false).parcalar.find((p) => /puanı/.test(p.ad))!;
  k.fsqPuan = 8.6;
  assert.deepEqual(parca(k), { ad: 'Foursquare puanı (/10 → /5)', puan: 6 }, '8,6/10 = 4,3/5');
  k.fsqPuan = 8.0;
  assert.equal(parca(k).puan, 4, '4,0/5');
  k.fsqPuan = 6.0;
  assert.equal(parca(k).puan, 1);
  k.googlePuan = 4.5;
  assert.deepEqual(parca(k), { ad: 'Google puanı', puan: 6 });
  assert.deepEqual(foursquareAyari(undefined), { anahtar: '', istekSiniri: 30, aylikSinir: 450, premiumAlanlar: false });
  assert.deepEqual(foursquareAyari({ anahtar: ' a ', istekSiniri: 9999, aylikSinir: -5, premiumAlanlar: 'evet' as never }), { anahtar: 'a', istekSiniri: 500, aylikSinir: 0, premiumAlanlar: false });
});
