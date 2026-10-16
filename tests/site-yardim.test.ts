import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { readYardim, yardimScript } from '../scripts/site-yardim.js';
import { appAudience, checkYardim, createYardimSearch, forAudience, YARDIM_KITLELER, type YardimKitle } from '../packages/domain/yardim.js';

/*
 * Mola Yardım (molayazilim.com.tr → "Yardım", and the café app's "?"): the questions in site/src/assets/yardim.json and the
 * search in site/src/assets/yardim.js, run here the way the browser runs it (the built file, no document: only the search
 * part); the app's copy of the search (packages/domain/yardim.ts) must answer the same.
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
  assert.equal(top('fiyatlar ne kadar'), 'fiyat');
  assert.equal(top('ücretsiz deneme'), 'deneme');
  assert.equal(top('internet olmazsa çalışır mı'), 'internetsiz');
  assert.equal(top('verilerim nerede'), 'veriler');
  assert.equal(top('kurulumu kim yapar'), 'kurulum-kim');
  assert.equal(top('hangi cihazlar'), 'cihazlar');
  assert.equal(top('yazar kasa'), 'yazar-kasa-site');
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

test('Mola Yardım: short answers in every topic, each with its audience; nothing internal in a question or an answer', () => {
  const data = readYardim(SRC);
  assert.ok(data.sorular.length >= 40 && data.sorular.length <= 100, `soru sayısı ${data.sorular.length}`);
  for (const k of data.konular) assert.ok(data.sorular.filter(q => q.konu === k.id).length >= 3, `${k.id} en az 3 soru`);
  const all = JSON.stringify(data);
  for (const banned of ['Mola Yönetim', '/api/', 'VDS', 'Caddy', 'HMAC', 'token', 'localhost', '127.0.0.1', '₺', 'innerHTML']) assert.ok(!all.includes(banned), `"${banned}" yardımda olmamalı`);
  // What people read (question and answer): no internals. "merkez.molayazilim.com.tr/yonet" (Kafemi yönet) is the one
  // address of Mola's own that may be named; "uçtan uca şifreli" at most once.
  const shown = (q: (typeof data.sorular)[number]) => [q.soru, ...q.cevap.flat()].join(' ').replaceAll('merkez.molayazilim.com.tr/yonet', '');
  for (const q of data.sorular) {
    const text = shown(q);
    for (const banned of ["Merkez'in", 'Merkez’in', 'Mola Merkez', 'Merkez', 'Mola Yönetim', 'relay', 'röle', 'API', 'sunucu', 'şifreleme', 'anahtar çifti', 'tünel', 'kitle', 'tenant']) assert.ok(!text.includes(banned), `${q.id}: "${banned}" yazılmamalı`);
    // Short: at most three sentences outside the steps, at most four steps.
    const sentences = q.cevap.filter(b => typeof b === 'string').join(' ').split(/[.!?](?:\s|$)/).filter(s => s.trim()).length;
    assert.ok(sentences <= 3, `${q.id}: ${sentences} cümle`);
    for (const b of q.cevap) if (Array.isArray(b)) assert.ok(b.length <= 4, `${q.id}: ${b.length} adım`);
    assert.ok(q.kitle.length >= 1, `${q.id}: kitle yok`);
  }
  assert.ok((all.match(/uçtan uca/g) ?? []).length <= 1);
  // The website's file holds the website's questions only (no role-only answers such as "İadeyi kasiyer yapar").
  for (const q of data.sorular) assert.equal(!!api.get(q.id), q.kitle.includes('site'), q.id);
  for (const id of forAudience(data, 'site').sikSorulanlar) assert.ok(api.get(id), id);
});

test('Mola Yardım audiences: known names only, at least one each; every role has its own topics; mistakes stop the build', () => {
  const data = readYardim(SRC);
  for (const q of data.sorular) for (const k of q.kitle) assert.ok((YARDIM_KITLELER as readonly string[]).includes(k), `${q.id}: ${k}`);
  const count = (k: YardimKitle) => data.sorular.filter(q => q.kitle.includes(k)).length;
  for (const k of YARDIM_KITLELER) assert.ok(count(k) >= 15, `${k}: ${count(k)} soru`);
  // Before buying: the website only, five to eight, never in the app.
  const tanisma = data.sorular.filter(q => q.konu === 'tanisma');
  assert.ok(tanisma.length >= 5 && tanisma.length <= 10);
  for (const q of tanisma) assert.deepEqual(q.kitle, ['site'], q.id);
  // Roles see their own work: the kitchen its board and fiş, the waiter orders and calls, the cashier the till.
  const ids = (k: YardimKitle) => new Set(data.sorular.filter(q => q.kitle.includes(k)).map(q => q.id));
  for (const id of ['mutfak-ekran', 'fis-modu', 'mutfak-iptal', 'vardiya-kodu']) assert.ok(ids('kitchen').has(id), `kitchen: ${id}`);
  for (const id of ['siparis-al', 'masa-tasi', 'qr-onay', 'garson-cagri', 'vardiya-kodu', 'tablet-giris']) assert.ok(ids('waiter').has(id), `waiter: ${id}`);
  for (const id of ['odeme-al', 'iade', 'hesap-bol', 'kasa-acilis', 'gun-sonu', 'gider', 'fis-cikmiyor', 'vardiya-kodu']) assert.ok(ids('cashier').has(id), `cashier: ${id}`);
  for (const id of ['iade', 'odeme-al', 'gun-sonu', 'kafemi-yonet-kur', 'yedek']) assert.ok(!ids('waiter').has(id) && !ids('kitchen').has(id), `garson/mutfak: ${id}`);
  // The app: the owner and the Müdür read every app question (their own first), the others only theirs; never the site's own.
  const appIds = new Set(data.sorular.filter(q => q.kitle.some(k => k !== 'site')).map(q => q.id));
  for (const role of ['owner', 'manager'] as const) {
    const seen = forAudience(data, appAudience(role));
    assert.deepEqual(new Set(seen.sorular.map(q => q.id)), appIds, role);
    assert.ok(seen.sorular.slice(0, count(role)).every(q => ids(role).has(q.id)), `${role}: kendi soruları önce`);
  }
  for (const role of ['cashier', 'waiter', 'kitchen'] as const) assert.deepEqual(new Set(forAudience(data, appAudience(role)).sorular.map(q => q.id)), ids(role), role);
  // A waiter asking about a refund is told who does it, not the cashier's steps.
  const waiter = createYardimSearch(forAudience(data, appAudience('waiter')));
  assert.equal(waiter.search('iade')[0]?.id, 'iade-garson');
  assert.ok(!waiter.search('iade').some(h => h.id === 'iade'));
  assert.equal(createYardimSearch(forAudience(data, appAudience('kitchen'))).search('fiş modu')[0]?.id, 'fis-modu');
  assert.equal(createYardimSearch(forAudience(data, appAudience('cashier'))).search('iade')[0]?.id, 'iade');
  // Mistakes in yardim.json stop the build with the question's id.
  const one = (kitle: unknown) => ({ konular: [{ id: 'kasa', ad: 'Kasa' }], sikSorulanlar: [], sorular: [{ id: 'bir', konu: 'kasa', kitle, soru: 'Soru?', cevap: ['Cevap.'], anahtar: ['soru'] }] }) as never;
  assert.throws(() => checkYardim(one([])), /bir.*kitle/);
  assert.throws(() => checkYardim(one(undefined)), /bir.*kitle/);
  assert.throws(() => checkYardim(one(['garson'])), /bilinmeyen kitle "garson"/);
  assert.throws(() => checkYardim(one(['support'])), /bilinmeyen kitle "support"/);
  assert.equal(checkYardim(one(['site', 'waiter'])).sorular[0].kitle.length, 2);
});

test('Mola Yardım: the app\'s search (packages/domain/yardim.ts) answers exactly as the website\'s (site/src/assets/yardim.js)', () => {
  const ts = createYardimSearch(forAudience(readYardim(SRC), 'site'));
  const words = ['gün sonu', 'gun sonu nasil yapilir', 'odeme', 'Ödeme nasıl alınır', 'yazici', 'yazci', 'odme', 'yaz', 'fiş çıkmıyor', 'kasa açılışı', 'iade',
    'hesap bölme', 'qr kod bas', 'internet kesildi', 'şifremi unuttum', 'kafemi yönet', 'android tablet apk', 'bilgisayar bozuldu', 'güncelleme', 'stok', 'mudur',
    'fiyat', 'deneme', 'vardiya kodu', 'garson çağırıyor', 'mutfak iptal', 'xqzt blorfmak', '<img src=x onerror=alert(1)>', '', 'nasıl', 'a'.repeat(300)];
  // (JSON: the website's results are objects of the sandbox, with its own Object.)
  for (const w of words) assert.deepEqual(ts.search(w), JSON.parse(JSON.stringify(api.search(w).map(h => ({ id: h.id, soru: h.soru, score: h.score })))), w);
});
