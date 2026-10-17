import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mahalleAdi, osmCevabiniIsle, overpassSorgusu } from '../kaynaklar/osm.js';

// Küçük, uydurma bir Overpass cevabı (gerçek sorgunun çıktı sırasıyla): ilçe → işletmeler → mahalle noktaları → mahalle sınırı + içindeki kimlikler.
const ornek = JSON.parse(readFileSync(new URL('./ornekler/overpass.json', import.meta.url), 'utf8'));

test('Overpass sorgusu: il ISO koduyla, Merkez seçeneği ilçe filtresi ekler', () => {
  assert.match(overpassSorgusu('il'), /"ISO3166-2"="TR-23"/);
  assert.match(overpassSorgusu('merkez'), /\["name"~"Merkez"\]/);
  assert.doesNotMatch(overpassSorgusu('il'), /\["name"~"Merkez"\]/);
});

test('Overpass cevabı → adaylar: ilçe, mahalle (sınırdan ya da yaklaşık), sosyal etiketler, tekrar eden öğe', () => {
  const { adaylar, ilceSayisi } = osmCevabiniIsle(ornek);
  assert.equal(ilceSayisi, 2);
  assert.equal(adaylar.length, 4, 'adı olmayan işletme ve iki ilçede görünen öğe bir kez');
  const [lale, cinar, firin, palu] = adaylar;
  assert.equal(lale.ad, 'Lale Cafe'); assert.equal(lale.ilce, 'Merkez');
  assert.equal(lale.mahalle, 'Cumhuriyet'); assert.equal(lale.mahalleYaklasik, false, 'mahalle sınırından');
  assert.equal(lale.instagram, 'lalekafe23'); assert.equal(lale.facebook, 'lalekafe');
  assert.equal(lale.eposta, 'bilgi@lalekafe.com.tr'); assert.equal(lale.telefon, '+90 424 111 22 33');
  assert.equal(lale.saatler, true); assert.equal(lale.osmTamlik, 1);
  assert.equal(lale.osmId, 'node/1');
  assert.equal(cinar.tur, 'Çay bahçesi'); assert.equal(cinar.mahalle, 'Sürsürü'); assert.equal(cinar.mahalleYaklasik, true, 'en yakın mahalle noktası');
  assert.equal(cinar.instagram, 'cinarbahce', 'web alanındaki Instagram adresi Instagram alanına taşındı');
  assert.equal(cinar.web, '');
  assert.equal(firin.mahalle, 'İzzet Paşa', 'adresteki mahalle (addr:suburb) önce gelir'); assert.equal(firin.tur, 'Fırın');
  assert.equal(firin.lat, 38.68, 'yol (way) için merkez noktası');
  assert.equal(palu.ilce, 'Palu'); assert.equal(palu.marka, 'Simit Sarayı');
  assert.equal(mahalleAdi('Cumhuriyet Mahallesi'), 'Cumhuriyet');
  assert.equal(mahalleAdi('Sürsürü Mah.'), 'Sürsürü');
});
