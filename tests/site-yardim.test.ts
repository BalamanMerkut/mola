import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { readYardim, yardimScript } from '../scripts/site-yardim.js';

/*
 * Mola Yardım (molayazilim.com.tr → "Yardım"): the questions in site/src/assets/yardim.json and the search in
 * site/src/assets/yardim.js, run here the way the browser runs it (the built file, no document: only the search part).
 */
const SRC = join('site', 'src');
type Hit = { id: string; soru: string; score: number };
type Api = { normalize(s: string): string; search(s: string, limit?: number): Hit[]; get(id: string): { soru: string } | null };
const sandbox: { MolaYardim?: Api } = {};
runInNewContext(yardimScript(SRC), sandbox);
const api = sandbox.MolaYardim!;
const top = (q: string) => api.search(q)[0]?.id;

test('Mola Yardım: Turkish letters, capitals and ASCII spellings meet', () => {
  assert.equal(api.normalize('Gün Sonu'), 'gun sonu');
  assert.equal(api.normalize('ÖDEME'), 'odeme');
  assert.equal(api.normalize('İADE  ışık'), 'iade isik');
  assert.equal(api.normalize('Yazıcı?!'), 'yazici');
  assert.equal(api.normalize('<img src=x onerror=alert(1)>'), 'img src x onerror alert 1');
});

test('Mola Yardım: everyday questions find their answer, with or without Turkish letters and with small typos', () => {
  assert.equal(top('gün sonu'), 'gun-sonu');
  assert.equal(top('gun sonu nasil yapilir'), 'gun-sonu');
  assert.equal(top('odeme'), 'odeme-al');
  assert.equal(top('Ödeme nasıl alınır'), 'odeme-al');
  assert.equal(top('yazici'), 'yazici');
  assert.equal(top('yazıcıyı nasıl bağlarım'), 'yazici');
  assert.equal(top('fiş çıkmıyor'), 'fis-cikmiyor');
  assert.equal(top('kasa açılışı'), 'kasa-acilis');
  assert.equal(top('iade'), 'iade');
  assert.equal(top('hesap bölme'), 'hesap-bol');
  assert.equal(top('qr kod bas'), 'qr-bas');
  assert.equal(top('internet kesildi'), 'internet-kesildi');
  assert.equal(top('şifremi unuttum'), 'sifre-unuttum');
  assert.equal(top('kafemi yönet'), 'kafemi-yonet-kur');
  assert.equal(top('kasa kapalı son durum'), 'kasa-kapali-son-durum');
  assert.equal(top('android tablet apk'), 'kafe-ici-cihazlar');
  assert.equal(top('bilgisayar bozuldu'), 'yeni-bilgisayar');
  assert.equal(top('güncelleme'), 'guncelleme');
  assert.equal(top('stok'), 'stok');
  assert.equal(top('mudur'), 'mudur');
  assert.equal(top('yazci'), 'yazici'); // one letter missing
  assert.equal(top('odme'), 'odeme-al');
  // Half-typed words already match.
  assert.ok(api.search('yaz').some(h => h.id === 'yazici'));
});

test('Mola Yardım: nonsense, markup and empty input find nothing and never throw', () => {
  assert.equal(api.search('xqzt blorfmak').length, 0);
  assert.equal(api.search('<img src=x onerror=alert(1)>').length, 0);
  assert.equal(api.search('').length, 0);
  assert.equal(api.search('nasıl').length, 0);
  assert.equal(api.search('.*+?^${}()|[]\\').length, 0);
  assert.ok(Array.isArray(api.search('a'.repeat(5000))));
  assert.ok(api.search('ödeme').length <= 6);
});

test('Mola Yardım: content is about using Mola only: 40-70 short answers in every topic, nothing internal', () => {
  const data = readYardim(SRC);
  assert.ok(data.sorular.length >= 40 && data.sorular.length <= 70, `soru sayısı ${data.sorular.length}`);
  for (const k of data.konular) assert.ok(data.sorular.filter(q => q.konu === k.id).length >= 3, `${k.id} en az 3 soru`);
  const all = JSON.stringify(data);
  for (const banned of ['Mola Yönetim', '/api/', 'VDS', 'Caddy', 'HMAC', 'token', 'localhost', '127.0.0.1', '₺', 'innerHTML']) assert.ok(!all.includes(banned), `"${banned}" yardımda olmamalı`);
  for (const q of data.sorular) {
    const sentences = q.cevap.filter(b => typeof b === 'string').join(' ').split(/[.!?](?:\s|$)/).filter(s => s.trim()).length;
    assert.ok(sentences <= 7, `${q.id}: ${sentences} cümle`);
    assert.ok(api.get(q.id), q.id);
  }
  for (const id of data.sikSorulanlar) assert.ok(api.get(id), id);
});
