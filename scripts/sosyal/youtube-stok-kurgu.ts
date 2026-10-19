/*
 * YouTube 02 "Stok, reçete ve kârlılık" (introduction series): the 1920×1080 video, kapak.jpg and aciklama.txt from the
 * recordings of scripts/sosyal/youtube-stok-kayit.ts, on the shared stage of scripts/sosyal/youtube-sahne.ts. No voice-over:
 * captions and the music of scripts/sosyal/muzik.py (soft breaks at the chapters), -20 LUFS.
 *
 *   npx tsx scripts/sosyal/youtube-stok-kurgu.ts              everything (scenes → video → music → kapak.jpg, aciklama.txt)
 *   npx tsx scripts/sosyal/youtube-stok-kurgu.ts c1 f3        only these scenes again (then the video is joined again)
 *   npx tsx scripts/sosyal/youtube-stok-kurgu.ts --kare       a few stills per scene (layout check), no video
 *   npx tsx scripts/sosyal/youtube-stok-kurgu.ts --kapak      only the thumbnail and the description
 *   MUZIK=cesit-12 npx tsx scripts/sosyal/youtube-stok-kurgu.ts   another track (the scenes are kept: only the music and the
 *                                                                  join run again); default cesit-11 (Re majör, 100 tempo)
 *   SOSYAL_CIKTI=<klasör> …                                     another output folder
 *
 * One linear story for an owner who weighs Mola, as video 01: the feature on the café computer's Mola window at normal size
 * (Malzemeler, Alış, Reçete with its options, "Toplu üretimden hesapla", a sale on the waiter's tablet and the stock it
 * lowers, Sayım), then Kârlılık; the setting that changes what is seen ("Uyarı sınırları": Düşük kâr uyarısı) full screen
 * with its control outlined and a slight 1.2× move, its effect, then one before/after split. The owner's rules (18–19
 * Ekim): the logo opening, then the title; no pointer: an ordinary click is a soft ripple only; a red outline at most once
 * per step, only where something small must be found ("Toplu üretimden hesapla", "Uyarı sınırları"); a label at the top
 * right "İşletme sahibi · Adım n / 8"; short plain captions; "30 gün ücretsiz deneme" on the closing card only.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import { C, ROOT, box, chapters, dirs, endCard, fmt, holdEnd, holdStart, introCard, introThumb, marks, ownerScene, screenSplitScene, shootThumb, staffScene, stepped, taps, uret, yer, type CaptionsOf, type Scene } from './youtube-sahne';

yer({ rec: join(ROOT, '.local', 'sosyal', 'youtube', 'stok', 'kayit'), work: join(ROOT, '.local', 'sosyal', 'youtube', 'stok', 'kurgu'),
  out: resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola YouTube', '02 Stok, reçete ve kârlılık')) });
const STEPS = 8, MUSIC = process.env.MUZIK ?? 'cesit-11';
const OWNER = `İşletme sahibi <b>· Adım {adim} / ${STEPS}</b>`;
type Opts = { step: number; taps?: string[]; gaps?: [number, number][]; toc?: string };
/** The owner's Mola window on the café computer, every caption carrying the step for the top-right label. */
function screen(name: string, clip: string, from: number, to: number, o: Opts, captions: CaptionsOf): Scene {
  return staffScene(name, clip, from, to, { frame: 'win', title: 'Mola · İşletme yönetimi', tag: OWNER, taps: o.taps, gaps: o.gaps },
    (at, d) => stepped(o.step, captions(at, d)), o.toc);
}
function scenes(): Scene[] {
  const list: Scene[] = [];
  list.push({ name: 'a0-giris', duration: 8, card: introCard('Stok, reçete ve kârlılık', 'Malzemeler, reçeteler, satışla düşen stok ve ürün başına kâr.'), toc: 'Giriş ve malzemeler' });

  // ===== 1. Malzemeler: a new ingredient =====
  const A = marks('s1-malzeme'), At = taps('s1-malzeme');
  list.push(screen('b1-malzeme', 's1-malzeme', .2, A.end - .3, { step: 1, taps: ['nav', 'add', 'name', 'unit', 'initial', 'min', 'price', 'save'] }, at => [
    { from: .2, to: at(A.items), text: '“Stok” işletme sahibinin ekranındadır.' },
    { from: at(A.items), to: at(At.add.on), text: 'Malzemeler: kalan miktar, uyarı sınırı ve birim fiyat.' },
    { from: at(At.add.on), to: at(A.amounts), text: '“Malzeme ekle”: adı ve ölçü birimi seçilir.' },
    { from: at(A.amounts), to: at(At.minHint.on), text: 'Şu an elde olan miktar yazılır: 2 litre.' },
    { from: at(At.minHint.on), to: at(At.price.on), text: 'Uyarı sınırı: stok bunun altına inince bildirim gelir.' },
    { from: at(At.price.on), to: at(A.saved), text: 'Birim fiyat: maliyet ve kâr bu fiyattan hesaplanır.' },
    { from: at(A.saved), to: 99, text: 'Malzeme listeye eklenir.' },
  ]));

  // ===== 2. Alış: stock and price up, an expense =====
  const B = marks('s2-alis'), Bt = taps('s2-alis');
  list.push(screen('b2-alis', 's2-alis', .2, B.end - .3, { step: 2, toc: 'Alış ve gider', taps: ['tab', 'buy', 'item', 'qty', 'total', 'supplier', 'outside', 'how', 'save', 'expenses'] }, at => [
    { from: .2, to: at(Bt.buy.on), text: '“Alış ve sayım”: gelen mal buradan kaydedilir.' },
    { from: at(Bt.buy.on), to: at(Bt.calc.on), text: '“Alış kaydet”: malzeme, miktar ve toplam tutar.' },
    { from: at(Bt.calc.on), to: at(Bt.supplier.on), text: 'Birim fiyat hesaplanır: litresi ₺40, önceki ₺36.' },
    { from: at(Bt.supplier.on), to: at(Bt.save.on), text: '“Para nereden çıktı?”: kasadan, kasa dışından ya da ödenmedi.' },
    { from: at(Bt.save.on), to: at(B.giderler), text: 'Stok ve birim fiyat güncellenir; alış gider olarak da yazılır.' },
    { from: at(B.giderler), to: 99, text: 'Gider, Kasa ve giderler → Giderler’de görünür.' },
  ]));

  // ===== 3. Reçete: Caffè Latte and its options =====
  const R = marks('s3-recete'), Rt = taps('s3-recete');
  list.push(screen('c1-recete', 's3-recete', .2, R.end - .3, { step: 3, toc: 'Reçete ve seçenekler', taps: ['nav', 'tab', 'latte', 'item1', 'amt1', 'row', 'item2', 'amt2', 'options', 'large', 'oat', 'from', 'to', 'save'] }, at => [
    { from: .2, to: at(Rt.latte.on), text: 'Stok → Reçeteler: her ürünün reçetesi ve maliyeti.' },
    { from: at(Rt.latte.on), to: at(R.items), text: 'Caffè Latte, 1 adet için: espresso çekirdeği 18 g, süt 200 ml.' },
    { from: at(R.items), to: at(Rt.large.on), text: 'Seçenekler stoktan düşen miktarı değiştirebilir.' },
    { from: at(Rt.large.on), to: at(Rt.oat.on), text: 'Büyük boy: bütün malzemeler %150 düşer.' },
    { from: at(Rt.oat.on), to: at(R.costs), text: 'Yulaf sütü seçilince süt yerine yulaf sütü düşer.' },
    { from: at(R.costs), to: at(Rt.save.on), text: 'Her seçeneğin maliyeti ve kâr oranı ayrı görünür.' },
    { from: at(Rt.save.on), to: 99, text: '“Reçeteyi kaydet”: bundan sonraki satışlara uygulanır.' },
  ]));

  // ===== 4. Toplu üretimden hesapla =====
  const T = marks('s4-toplu'), Tt = taps('s4-toplu');
  list.push(screen('c2-toplu', 's4-toplu', .2, T.end - .3, { step: 4, toc: 'Toplu üretimden reçete', taps: ['ss', '!batch', 'item0', 'total0', 'more1', 'item1', 'total1', 'more2', 'item2', 'total2', 'more3', 'item3', 'total3', 'portions', 'write', 'save'] }, at => [
    { from: .2, to: at(Tt.batch.on), text: 'Tatlı gibi toplu hazırlananlarda reçete bir seferden hesaplanır.' },
    { from: at(Tt.batch.on), to: at(T.batch), text: 'San Sebastian → “Toplu üretimden hesapla”.' },
    { from: at(T.batch), to: at(Tt.portions.on), text: 'Bir seferde kullanılan malzemeler ve toplam miktarları yazılır.' },
    { from: at(Tt.portions.on), to: at(Tt.write.on), text: '“Kaç porsiyon çıktı?”: 16. Porsiyon başı hesaplanır.' },
    { from: at(Tt.write.on), to: at(Tt.save.on), text: '“Reçeteye yaz”: miktarlar reçeteye geçer.' },
    { from: at(Tt.save.on), to: 99, text: 'Reçete kaydedilir; maliyeti listede görünür.' },
  ]));

  // ===== 5. A sale lowers the stock =====
  const U = marks('s5-urunler'), Ut = taps('s5-urunler');
  list.push(screen('d1-urunler', 's5-urunler', .2, U.end - .2, { step: 5, toc: 'Satış ve stok', taps: ['tab'] }, at => [
    { from: .2, to: at(Ut.latte.on), text: 'Stok → Ürünler: her üründen kaç adet daha yapılabileceği.' },
    { from: at(Ut.latte.on), to: 99, text: 'Seçeneklere göre ayrı ayrı; en önce bitecek malzeme de yazar.' },
  ]));
  const S = marks('t1-satis'), St = taps('t1-satis');
  list.push(staffScene('d2-satis', 't1-satis', .4, S.end - .3, { frame: 'tablet', tag: 'Garson tableti', taps: ['table', 'add', 'cat', 'product', 'large', 'oat', 'more', 'toCart', 'cart', 'send'] }, at => [
    { from: .2, to: at(St.send.on), text: 'Garson 2 Caffè Latte alır: büyük boy, yulaf sütüyle.' },
    { from: at(St.send.on), to: 99, text: 'Sipariş gönderilir.' },
  ]));
  const O = marks('s6-sonra'), Ot = taps('s6-sonra');
  list.push(screen('d3-sonra', 's6-sonra', Ot.items.tap! - .3, O.end - .2, { step: 5, taps: ['items', '!toast', 'products'], gaps: [[Ot.card.off! + .2, O.toast - .3]] }, at => [
    { from: .2, to: at(Ot.card.on), text: 'Satış stoğu reçeteye göre kendiliğinden düşürür.' },
    { from: at(Ot.card.on), to: at(O.toast), text: 'Yulaf sütü 2 L’den 1,4 L’ye iner: uyarı sınırının altında, “Az kaldı”.' },
    { from: at(O.toast), to: at(Ot.products.on), text: 'Bildirim gelir: “Yulaf sütü azaldı”.' },
    { from: at(Ot.products.on), to: 99, text: 'Ürünler’de yulaf sütlü latte 10’dan 7’ye iner.' },
  ]));

  // ===== 6. Sayım ve fire =====
  const K = marks('s7-sayim'), Kt = taps('s7-sayim');
  list.push(holdEnd(screen('e1-sayim', 's7-sayim', .2, K.end - .2, { step: 6, toc: 'Sayım ve fire', taps: ['tab', 'count', 'milk', 'save'] }, (at, d) => [
    { from: .2, to: at(Kt.milk.on), text: 'Alış ve sayım → “Sayım yap”.' },
    { from: at(Kt.milk.on), to: at(Kt.save.on), text: 'Rafta sayılan miktar yazılır; beklenenle farkı görünür.' },
    { from: at(Kt.save.on), to: at(Kt.tiles.on), text: 'Stok sayılan miktardan devam eder.' },
    { from: at(Kt.tiles.on), to: d + .6, text: '“Fire kaydet”: bozulan, dökülen malzeme stoktan düşülür.' },
    { from: d + .6, to: 99, text: 'İptal edilen üründe mutfağa “Bu üründen stok kullanıldı mı?” diye sorulur.' },
  ]), 4.2));

  // ===== 7. Kârlılık =====
  const P = marks('s8-karlilik'), Pt = taps('s8-karlilik');
  list.push(screen('f1-karlilik', 's8-karlilik', .2, Pt.rows.off! - .1, { step: 7, toc: 'Kârlılık ve düşük kâr uyarısı', taps: ['nav', 'detail', 'tab'] }, at => [
    { from: .2, to: at(P.report), text: 'Satış ve Raporlar → “Detaylı göster” → Kârlılık.' },
    { from: at(P.report), to: at(Pt.rows.on), text: 'Bugünün satışı, malzeme maliyeti ve brüt kârı.' },
    { from: at(Pt.rows.on), to: 99, text: 'Ürün başına satış, maliyet, kâr ve kâr oranı.' },
  ]));

  // ===== 8. The setting: Düşük kâr uyarısı ("Uyarı sınırları"), full screen =====
  const f2 = ownerScene('f2-esik', 's8-karlilik', Pt.rows.off! - .1, P.end - .2, ['!limits', 'drinks', 'save', 'close'], (at, d) => stepped(8, [
    { from: .2, to: at(P.limitsOpen), text: 'Ayar: Kârlılık → “Uyarı sınırları”.' },
    { from: at(P.limitsOpen), to: at(Pt.drinks.on), text: 'Her ürün grubu için en az kâr oranı: içeceklerde %70 gelir.' },
    { from: at(Pt.drinks.on), to: at(Pt.save.on), text: 'İçecekler için %80 yazılır.' },
    { from: at(Pt.save.on), to: at(P.after), text: '“Kaydet”: Kârlılık ve reçeteler bu sınırla işaretlenir.' },
    { from: at(P.after), to: d + 1, text: '%80’in altındaki içecekler “Düşük kâr” olarak işaretlenir.' },
  ]), undefined, { tag: OWNER });
  // The window's "Kaydet" sits at the bottom of the screen: the captions stand at the top left here (clear of the label).
  list.push({ ...holdStart(f2, 1.4), css: '.cap.overlay{top:30px;bottom:auto;left:40px;right:auto}' });
  // The same window height on both sides (the table moved 5 px between the two moments).
  const before = box('s8-karlilik', 'tableBefore', { x: 280, y: 150, width: 962, height: 552 }), after = { ...box('s8-karlilik', 'tableAfter', before), height: before.height };
  list.push(screenSplitScene('f3-karsilastirma', 'Düşük kâr uyarısı: içecekler', 'Satış ve Raporlar · Kârlılık',
    { clip: 's8-karlilik', t: Pt.rows.on + 1.5, label: 'Varsayılan · %70', region: before },
    { clip: 's8-karlilik', t: Pt.lows.on + 1.5, label: 'İçecekler · %80', region: after },
    '%70’te işaret yok; %80’de sınırın altındaki içecekler işaretlenir.', 8));
  list.push({ name: 'g0-son', duration: 7.5, card: endCard });
  return list;
}

// ---------- Description and thumbnail ----------
function description(list: Scene[]) {
  const { lines, total } = chapters(list);
  const title = 'Stok, reçete ve kârlılık: malzemeden ürün başına kâra | Mola';
  if (title.length > 70) throw new Error(`Başlık ${title.length} karakter.`);
  const text = `BAŞLIK (${title.length} karakter)
${title}

AÇIKLAMA
Bu videoda Mola adisyon ve QR menü sisteminde stok, reçete ve kârlılığın nasıl çalıştığı gösteriliyor. Görüntüler uygulamanın kendisinden, örnek bir işletmeyle kaydedildi.

Videoda:
- Stok → Malzemeler: malzeme eklenir; ölçü birimi, elde olan miktar, uyarı sınırı ve birim fiyat yazılır.
- Alış ve sayım → Alış kaydet: alış stoğu ve birim fiyatı günceller; "Para nereden çıktı?" sorusuyla gider olarak da yazılır ve Kasa ve giderler → Giderler'de görünür.
- Reçeteler: bir ürünün 1 adedi için malzemeler ve miktarlar; seçeneklerin stoktan düşeni değiştirmesi (Büyük boy %150, yulaf sütü sütün yerine); seçeneklere göre maliyet ve kâr oranı.
- Toplu üretimden hesapla: bir seferde kullanılan malzemeler ve çıkan porsiyon sayısından porsiyon başı reçete.
- Satış stoğu reçeteye göre kendiliğinden düşürür; Ürünler'de her üründen kaç adet daha yapılabileceği görünür. Uyarı sınırının altına inen malzeme "Az kaldı" olarak işaretlenir, bildirim gelir.
- Sayım ve fire; iptal edilen üründe mutfağa "Bu üründen stok kullanıldı mı?" diye sorulur.
- Satış ve Raporlar → Kârlılık: ürün başına satış, malzeme maliyeti, kâr ve kâr oranı.
- Ayar: Kârlılık → Uyarı sınırları (Düşük kâr uyarısı). Ürün grubu başına en az kâr oranı; sınırın altındaki ürünler "Düşük kâr" olarak işaretlenir. Önce / sonra karşılaştırmasıyla.

Bölümler
${lines.join('\n')}

Mola 30 gün ücretsiz denenebilir.
Web: https://molayazilim.com.tr
E-posta: destek@molayazilim.com.tr

ETİKETLER
Mola, Mola adisyon, stok takibi, reçete maliyeti, kafe stok programı, restoran stok takibi, ürün maliyeti, kâr oranı, kârlılık raporu, malzeme takibi, adisyon programı, kafe yazılımı, restoran yazılımı, Elazığ
`;
  writeFileSync(join(dirs.out, 'aciklama.txt'), text.replace(/\n/g, '\r\n'));
  console.log(lines.join('\n'), `\nToplam ${fmt(total)} (${total.toFixed(1)} sn)`);
}
/** The round badge of the thumbnail: a box (Stok). */
const stockBadge = `<svg viewBox="0 0 24 24" width="70" height="70" fill="none" stroke="${C.green}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/></svg>`;
async function thumbnail(browser: Browser) {
  // The owner's Stok → Malzemeler on a phone (Yulaf sütü "Az kaldı" on top), shot off camera by the recorder.
  await shootThumb(browser, introThumb({ title: 'Stok, reçete<br>ve kârlılık', shot: join(dirs.rec, 'kapak-telefon.png'), badge: stockBadge }));
}

await uret({ mp4: 'Stok, reçete ve kârlılık.mp4', music: MUSIC, description, thumbnail, scenes,
  stillsAt: process.env.KARE_SIK ? (s => Array.from({ length: Math.ceil(s.duration / 2) }, (_, i) => Math.min(s.duration - .05, i * 2 + .6))) : undefined });
