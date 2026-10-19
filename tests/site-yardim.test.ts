import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { readYardim, yardimScript } from '../scripts/site-yardim.js';
import { appAudience, checkYardim, createYardimSearch, forAudience, YARDIM_KITLELER, YARDIM_VIDEOLAR, yardimVideoSure, yardimVideoUrl, type YardimKitle, type YardimVideo } from '../packages/domain/yardim.js';

/*
 * Mola Yardım (molayazilim.com.tr → "Yardım", and the café app's "?"): the questions in site/src/assets/yardim.json and the
 * search in site/src/assets/yardim.js, run here the way the browser runs it (the built file, no document: only the search
 * part); the app's copy of the search (packages/domain/yardim.ts) must answer the same.
 * 19 Ekim: typos still find the answer (or "Bunu mu demek istediniz?"), and answers point to the video moment that shows them.
 */
const SRC = join('site', 'src');
type Hit = { id: string; soru: string; score: number };
type Api = {
  normalize(s: string): string; search(s: string, limit?: number): Hit[]; ask(s: string, limit?: number): { sure: boolean; hits: Hit[] };
  get(id: string): { soru: string; video?: YardimVideo[] } | null; videoUrl(v: { id: string; t: number }): string | null;
};
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
  assert.equal(top('işletmemi yönet'), 'kafemi-yonet-kur');
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
  assert.equal(top('değiştirme süresi'), 'degistirme-suresi'); // 17 Ekim: the kitchen gets a QR order when it ends
  assert.equal(top('sipariş mutfağa düşmedi'), 'degistirme-suresi');
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
  // What people read (question and answer): no internals. "isletme.molayazilim.com.tr" (İşletmemi yönet, 16 Ekim) is the one
  // address of Mola's own that may be named (never the old kafem. or merkez.…/yonet); "uçtan uca şifreli" at most once.
  const shown = (q: (typeof data.sorular)[number]) => [q.soru, ...q.cevap.flat()].join(' ').replaceAll('isletme.molayazilim.com.tr', '');
  for (const q of data.sorular) {
    const text = shown(q);
    for (const old of ['kafem.', 'merkez.molayazilim.com.tr', 'Kafemi yönet', 'molayazilim.com.tr/yonet']) assert.ok(!text.includes(old), `${q.id}: "${old}" yazılmamalı`);
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
  // 18 Ekim: Reçete → "Toplu üretimden hesapla", for the owner and the Müdür (not the site).
  for (const role of ['owner', 'manager'] as const) for (const q of ['toplu üretim reçete', 'kaç porsiyon çıktı']) assert.equal(createYardimSearch(forAudience(data, appAudience(role))).search(q)[0]?.id, 'recete-toplu', `${role}: ${q}`);
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
    'hesap bölme', 'qr kod bas', 'internet kesildi', 'şifremi unuttum', 'işletmemi yönet', 'android tablet apk', 'bilgisayar bozuldu', 'güncelleme', 'stok', 'mudur',
    'fiyat', 'deneme', 'vardiya kodu', 'garson çağırıyor', 'mutfak iptal', 'xqzt blorfmak', '<img src=x onerror=alert(1)>', '', 'nasıl', 'a'.repeat(300)];
  // (JSON: the website's results are objects of the sandbox, with its own Object.)
  for (const w of words) assert.deepEqual(ts.search(w), JSON.parse(JSON.stringify(api.search(w).map(h => ({ id: h.id, soru: h.soru, score: h.score })))), w);
  // 19 Ekim: typos and the "sure or suggest" decision too.
  for (const w of [...words, ...TYPOS.filter(c => c[0] === 'site').map(c => c[1]), 'kurulm', 'fiyt', 'ucretsz denme', 'qr kod basma', 'nasl', 'yazcı', 'hesp bolme', 'gidr', 'egitim vidyosu']) {
    assert.deepEqual(ts.ask(w), JSON.parse(JSON.stringify(api.ask(w))), w);
  }
});

/** 19 Ekim: what someone may type with typos and missing Turkish letters, per role, and the answer it must still find. */
const TYPOS: [YardimKitle, string, string][] = [
  ['cashier', 'giderr nasl kaydedlr', 'gider'], ['cashier', 'gün sonu nasl yapılr', 'gun-sonu'], ['cashier', 'odeme nasl alnir', 'odeme-al'],
  ['cashier', 'hsap bölme', 'hesap-bol'], ['cashier', 'kasa acilsi', 'kasa-acilis'], ['cashier', 'iade nasıl yapılr', 'iade'], ['cashier', 'yazar kasya', 'yazar-kasa'],
  ['waiter', 'masa tasima', 'masa-tasi'], ['waiter', 'masyı taşıma', 'masa-tasi'], ['waiter', 'garson cagırıyor', 'garson-cagri'],
  ['waiter', 'qr sipraiş onayı', 'qr-onay'], ['waiter', 'egitim vidyosu', 'egitim-videolari'],
  ['kitchen', 'mutfak ekranı nasl kullanılr', 'mutfak-ekran'], ['kitchen', 'fis modunda calısma', 'fis-modu'], ['kitchen', 'ses gelmyor', 'mutfak-ses'],
  ['kitchen', 'fire kayd', 'stok-mutfak'], ['kitchen', 'videolar nerde', 'egitim-videolari'],
  ['manager', 'raporlr', 'raporlar'], ['manager', 'tükendi yapma', 'tukendi'],
  ['owner', 'yazıcı bağlma', 'yazici'], ['owner', 'calışan ekleme', 'calisan-ekle'], ['owner', 'kasyer', 'calisan-ekle'], ['owner', 'yedeklme', 'yedek'],
  ['owner', 'uzaktn erişm', 'kafemi-yonet-kur'], ['owner', 'kurtarma kdu', 'kurtarma-kodu'], ['owner', 'logo degıstırme', 'gorunum'],
  ['site', 'ücretsz deneme', 'deneme'], ['site', 'internet olmasa calısırmı', 'internetsiz'], ['site', 'Mola nedir?', 'mola-nedir'], ['site', 'egitim videolari', 'egitim-videolari'],
];
const finderFor = (data: ReturnType<typeof readYardim>, k: YardimKitle) => createYardimSearch(forAudience(data, k === 'site' ? 'site' : appAudience(k)));

test('Mola Yardım typos (19 Ekim): misspelt words, missing Turkish letters and a typo of "nasıl" still answer, per role', () => {
  const data = readYardim(SRC);
  for (const [k, q, id] of TYPOS) {
    const r = finderFor(data, k).ask(q);
    assert.equal(r.hits[0]?.id, id, `${k}: ${q} → ${r.hits.map(h => h.id).join(', ')}`);
    assert.equal(r.sure, true, `${k}: ${q} emin olmalı`);
  }
  // A word the questions know is never read as another one's typo ("kasa" stays kasa, never "masa").
  assert.equal(finderFor(data, 'cashier').ask('kasa açılışı').hits[0].id, 'kasa-acilis');
  assert.ok(!finderFor(data, 'waiter').search('kasa').some(h => h.id === 'masa-tasi'));
  // Every role's everyday questions, written correctly, are answered at once as before.
  for (const [k, q, id] of [['cashier', 'gün sonu', 'gun-sonu'], ['waiter', 'iade', 'iade-garson'], ['kitchen', 'fiş modu', 'fis-modu'], ['manager', 'tükendi', 'tukendi'], ['owner', 'yedek', 'yedek']] as const) {
    const r = finderFor(data, k).ask(q);
    assert.deepEqual([r.sure, r.hits[0]?.id], [true, id], `${k}: ${q}`);
  }
  // Quick: keywords are prepared once per audience; the whole list twenty times well under two seconds.
  const owner = finderFor(data, 'owner'), t0 = performance.now();
  for (let i = 0; i < 20; i++) for (const [, q] of TYPOS) owner.ask(q);
  assert.ok(performance.now() - t0 < 2000, `${Math.round(performance.now() - t0)} ms`);
});

test('Mola Yardım typos (19 Ekim): in doubt, "Bunu mu demek istediniz?" with two or three questions, the meant one among them', () => {
  const data = readYardim(SRC);
  for (const [k, q, id] of [['owner', 'calsan ekle', 'calisan-ekle'], ['waiter', 'servise hazr', 'servise-hazir'], ['manager', 'tükndi', 'tukendi'], ['site', 'kurulm', 'kurulum-indir'], ['site', 'fiyt', 'fiyat']] as const) {
    const r = finderFor(data, k).ask(q);
    assert.equal(r.sure, false, `${k}: ${q}`);
    assert.ok(r.hits.length >= 2 && r.hits.length <= 3, `${k}: ${q}: ${r.hits.length}`);
    assert.ok(r.hits.some(h => h.id === id), `${k}: ${q} → ${r.hits.map(h => h.id).join(', ')}`);
  }
  // The website's own file decides the same.
  assert.equal(api.ask('kurulm').sure, false);
  assert.equal(api.ask('giderr nasl kaydedlr').hits[0].id, 'gider');
  // Nonsense, a lone "nasl" and markup: nothing to suggest either.
  for (const q of ['xqzt blorfmak', 'nasl', 'nsl yapılr', '<img src=x onerror=alert(1)>', '']) assert.deepEqual(JSON.parse(JSON.stringify(api.ask(q))), { sure: false, hits: [] }, q);
});

/** 19 Ekim: the videos as published on youtube.com/@molayazilim and their lengths (seconds). */
const VIDEOS: Record<string, [string, number]> = {
  '00': ['wpMZdS5dPgw', 117], '01': ['GXqUnXGY5vo', 233], '02': ['NDYQ_bvUIj0', 297], '03': ['xAMiBM8M89I', 294], '04': ['dSAqQq_d3fE', 292], '05': ['WYMVLdIAsVs', 288],
  '06': ['d49M0PuJO94', 309], E1: ['uxh2tuyR6oY', 190], E2: ['n_JDwbQ7peA', 240], E3: ['H5iJWKpwtBY', 183], E4: ['JxhE4ESU4H4', 212], E5: ['2lbq7fz6BXs', 240],
};

test('Mola Yardım videos (19 Ekim): only the twelve videos, inside their length; the asker\'s own training video first, at most two', () => {
  const data = readYardim(SRC), length = new Map(Object.values(VIDEOS));
  assert.deepEqual(new Map(Object.entries(YARDIM_VIDEOLAR).map(([id, v]) => [id, v.sure])), length);
  const withVideo = data.sorular.filter(q => q.video?.length);
  assert.ok(withVideo.length >= 50, `videolu cevap ${withVideo.length}`);
  for (const q of withVideo) for (const v of q.video!) {
    assert.ok(length.has(v.id), `${q.id}: ${v.id}`);
    assert.ok(Number.isInteger(v.t) && v.t >= 0 && v.t < length.get(v.id)!, `${q.id}: ${v.id} t=${v.t}`);
    assert.ok(v.baslik.startsWith(`${YARDIM_VIDEOLAR[v.id].ad} · `), `${q.id}: ${v.baslik}`);
    for (const k of v.kitle ?? []) assert.ok(q.kitle.includes(k), `${q.id}: ${k}`);
  }
  // The text stays the answer: the link is separate.
  for (const q of data.sorular) assert.ok(!q.cevap.flat().join(' ').includes('watch?v='), q.id);
  const audience = (k: YardimKitle) => forAudience(data, k === 'site' ? 'site' : appAudience(k));
  const seen = (k: YardimKitle, id: string) => audience(k).sorular.find(q => q.id === id)?.video ?? [];
  for (const k of YARDIM_KITLELER) for (const q of audience(k).sorular) {
    assert.ok((q.video ?? []).length <= 2, `${k}: ${q.id}`);
    for (const v of q.video ?? []) assert.deepEqual(Object.keys(v), ['id', 't', 'baslik'], `${k}: ${q.id}`);
  }
  const first = (k: YardimKitle, id: string) => { const v = seen(k, id)[0]; return v && [v.id, v.t]; };
  assert.deepEqual(seen('cashier', 'gider'), [{ id: VIDEOS.E2[0], t: 174, baslik: 'Kasiyer eğitimi · Gider kaydetme' }]);
  assert.deepEqual(first('waiter', 'masa-tasi'), [VIDEOS.E1[0], 145]);
  assert.deepEqual(first('owner', 'qr-durdur'), [VIDEOS['01'][0], 136]);
  assert.deepEqual(first('manager', 'qr-durdur'), [VIDEOS.E4[0], 127]);
  assert.deepEqual(first('site', 'kurulum-indir'), [VIDEOS['06'][0], 8]);
  assert.deepEqual(first('owner', 'kurulum-indir'), [VIDEOS['06'][0], 8]);
  assert.deepEqual(first('site', 'mola-nedir'), [VIDEOS['00'][0], 0]);
  assert.deepEqual(first('kitchen', 'mutfak-iptal'), [VIDEOS.E3[0], 99]);
  assert.deepEqual(first('site', 'odeme-al'), [VIDEOS['00'][0], 43]);
  assert.deepEqual(first('cashier', 'odeme-al'), [VIDEOS.E2[0], 31]);
  // "Eğitim videoları nerede?": everyone's own training video (the website: the short introduction); the channel in the text.
  for (const [k, v] of [['waiter', 'E1'], ['cashier', 'E2'], ['kitchen', 'E3'], ['manager', 'E4'], ['owner', 'E5'], ['site', '00']] as const) {
    assert.deepEqual(seen(k, 'egitim-videolari').map(x => x.id), [VIDEOS[v][0]], k);
    if (k !== 'owner') assert.equal(seen(k, 'tablet-giris')[0].id, VIDEOS[k === 'site' ? '06' : v][0], `tablet-giris ${k}`);
  }
  assert.ok(data.sorular.find(q => q.id === 'egitim-videolari')!.cevap.join(' ').includes('youtube.com/@molayazilim'));
  // The owner reading a waiter's question gets the waiter's video (none of the owner's own there).
  assert.deepEqual(first('owner', 'odeme-garson'), [VIDEOS.E1[0], 161]);
  // The link: the video at that moment, "2:54".
  assert.equal(yardimVideoUrl({ id: VIDEOS.E2[0], t: 174 }), 'https://www.youtube.com/watch?v=n_JDwbQ7peA&t=174s');
  assert.equal(yardimVideoSure(174), '2:54'); assert.equal(yardimVideoSure(8), '0:08');
  // The website's file carries the website's videos and builds the same address; anything else is no link.
  assert.deepEqual(JSON.parse(JSON.stringify(api.get('mola-nedir')!.video)), seen('site', 'mola-nedir'));
  assert.equal(api.videoUrl({ id: VIDEOS.E2[0], t: 174 }), yardimVideoUrl({ id: VIDEOS.E2[0], t: 174 }));
  assert.equal(api.videoUrl({ id: 'javascript:x', t: 1 }), null);
  // Mistakes stop the build.
  const one = (video: unknown) => ({ konular: [{ id: 'kasa', ad: 'Kasa' }], sikSorulanlar: [], sorular: [{ id: 'bir', konu: 'kasa', kitle: ['cashier'], soru: 'Soru?', cevap: ['Cevap.'], anahtar: ['soru'], video }] }) as never;
  assert.throws(() => checkYardim(one([{ id: 'dQw4w9WgXcQ', t: 1, baslik: 'Başka · video' }])), /bilinmeyen video/);
  assert.throws(() => checkYardim(one([{ id: VIDEOS.E2[0], t: 240, baslik: 'Kasiyer eğitimi · Son' }])), /t 0 ile 239/);
  assert.throws(() => checkYardim(one([{ id: VIDEOS.E2[0], t: 1.5, baslik: 'Kasiyer eğitimi · Son' }])), /t 0 ile/);
  assert.throws(() => checkYardim(one([{ id: VIDEOS.E2[0], t: 10, baslik: 'Garson eğitimi · Giriş' }])), /baslik "Kasiyer eğitimi · …"/);
  assert.throws(() => checkYardim(one([{ id: VIDEOS.E2[0], t: 10, baslik: 'Kasiyer eğitimi · Giriş', kitle: ['waiter'] }])), /kitle sorunun kitlesinden/);
  assert.throws(() => checkYardim(one([])), /video 1-6/);
  assert.equal(checkYardim(one([{ id: VIDEOS.E2[0], t: 10, baslik: 'Kasiyer eğitimi · Giriş' }])).sorular[0].video!.length, 1);
});

