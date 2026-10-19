/*
 * YouTube 03 "Raporlar" (introduction series): the 1920×1080 video, kapak.jpg and aciklama.txt from the recordings of
 * scripts/sosyal/youtube-rapor-kayit.ts, on the shared stage of scripts/sosyal/youtube-sahne.ts. No voice-over: captions and
 * the music of scripts/sosyal/muzik.py (soft breaks at the chapters), -20 LUFS.
 *
 *   npx tsx scripts/sosyal/youtube-rapor-kurgu.ts              everything (scenes → video → music → kapak.jpg, aciklama.txt)
 *   npx tsx scripts/sosyal/youtube-rapor-kurgu.ts c1 f3        only these scenes again (then the video is joined again)
 *   npx tsx scripts/sosyal/youtube-rapor-kurgu.ts --kare       a few stills per scene (layout check), no video
 *   npx tsx scripts/sosyal/youtube-rapor-kurgu.ts --kapak      only the thumbnail and the description
 *   MUZIK=cesit-13 npx tsx scripts/sosyal/youtube-rapor-kurgu.ts   another track (the scenes are kept: only the music and the
 *                                                                   join run again); default cesit-12 (Sol majör, 100 tempo)
 *   SOSYAL_CIKTI=<klasör> …                                     another output folder
 *
 * One linear story for an owner who weighs Mola, as videos 01 and 02: the owner's reports on the café computer's Mola window at
 * normal size (today's plain summary, the periods and their comparison, the detailed Özet with Kanallar and KDV dökümü,
 * Ürünler, the QR share, Kârlılık, Kasa kapanışları, "Yazdır ve paylaş": the A4 page, PDF and the accountant's Excel); the two
 * settings that change what the reports show or send, each full screen with its control outlined and a slight 1.2× move:
 * "POS komisyon oranı" (its effect on Elde kalan the next day, then one before/after split) and "Raporları gönder" (what
 * arrives after the gün sonu); the owner's phone at the end. The owner's rules (18–19 Ekim): the logo opening, then the title;
 * no pointer: an ordinary click is a soft ripple only; a red outline at most once per step, only where something small must
 * be found; a label at the top right "İşletme sahibi · Adım n / 10"; short plain captions; "30 gün ücretsiz deneme" on the
 * closing card only.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import { C, ROOT, chapters, dirs, endCard, fmt, guestScene, holdEnd, holdStart, introCard, introThumb, marks, ownerScene, screenSplitScene, shootThumb, staffScene, stepped, taps, uret, yer, type CaptionsOf, type Layer, type Scene } from './youtube-sahne';

yer({ rec: join(ROOT, '.local', 'sosyal', 'youtube', 'rapor', 'kayit'), work: join(ROOT, '.local', 'sosyal', 'youtube', 'rapor', 'kurgu'),
  out: resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola YouTube', '03 Raporlar')) });
const STEPS = 10, MUSIC = process.env.MUZIK ?? 'cesit-12';
const OWNER = `İşletme sahibi <b>· Adım {adim} / ${STEPS}</b>`;
type Opts = { step: number; taps?: string[]; gaps?: [number, number][]; toc?: string };
/** The owner's Mola window on the café computer, every caption carrying the step for the top-right label. */
function screen(name: string, clip: string, from: number, to: number, o: Opts, captions: CaptionsOf): Scene {
  return staffScene(name, clip, from, to, { frame: 'win', title: 'Mola · İşletme yönetimi', tag: OWNER, taps: o.taps, gaps: o.gaps },
    (at, d) => stepped(o.step, captions(at, d)), o.toc);
}
/** A setting full screen (ownerScene), its first picture held for the first caption; `top`: captions at the top left (the control sits low). */
function setting(name: string, clip: string, from: number, to: number, step: number, names: string[], captions: CaptionsOf, o: { toc?: string; top?: boolean; gaps?: [number, number][] } = {}): Scene {
  const scene = holdStart(ownerScene(name, clip, from, to, names, (at, d) => stepped(step, captions(at, d)), o.toc, { tag: OWNER, gaps: o.gaps }), 1.2);
  return o.top ? { ...scene, css: '.cap.overlay{top:30px;bottom:auto;left:40px;right:auto}' } : scene;
}

function scenes(): Scene[] {
  const list: Scene[] = [];
  list.push({ name: 'a0-giris', duration: 8, card: introCard('Raporlar', 'Günün özeti, dönem karşılaştırması, personel, kasa ve e-posta raporları.'), toc: 'Giriş ve bugünün özeti' });

  // ===== 1. Today's plain summary =====
  const A = marks('r1-bugun'), At = taps('r1-bugun');
  list.push(screen('b1-bugun', 'r1-bugun', .2, A.end - .3, { step: 1, taps: ['nav'] }, at => [
    { from: .2, to: at(A.report), text: '“Satış ve Raporlar” işletme sahibinin ekranındadır.' },
    { from: at(A.report), to: at(At.grid.on), text: 'Gün tek cümleyle özetlenir: sipariş, satış ve dünkü değişim.' },
    { from: at(At.grid.on), to: at(At.kept.on), text: 'Satış, giderler, elde kalan ve sipariş sayısı.' },
    { from: at(At.kept.on), to: at(A.pair), text: 'Elde kalan = satış − giderler − iadeler − kart komisyonu.' },
    { from: at(A.pair), to: 99, text: 'En çok kazandıran 3 ürün ve kasada olması gereken nakit.' },
  ]));

  // ===== 2. The periods and their comparison =====
  const B = marks('r2-donem');
  const Bt = taps('r2-donem');
  list.push(screen('b2-donem', 'r2-donem', .2, Bt.yearMenu.off! + .2, { step: 2, toc: 'Dönemler ve karşılaştırma', taps: ['d7', 'd30', 'year'], gaps: [[Bt.grid30.on, Bt.grid30.off!]] }, at => [
    { from: .2, to: at(B.week), text: 'Dönem üstten seçilir: Bugün, 7 gün, 30 gün, Yıl.' },
    { from: at(B.week), to: at(B.month), text: '7 gün: önceki 7 günle karşılaştırılır.' },
    { from: at(B.month), to: at(B.year), text: '30 gün: önceki 30 günle karşılaştırılır.' },
    { from: at(B.year), to: 99, text: 'Yıl: yılbaşından bugüne. Biten her yıl kendi dosyasına alınır.' },
  ]));

  // ===== 3. The detailed Özet =====
  const D = marks('r3-detay'), Dt = taps('r3-detay');
  list.push(screen('c1-detay', 'r3-detay', 1.6, D.end - .3, { step: 3, taps: ['detail'], gaps: [[Dt.chart.on + 2.8, Dt.chart.off!]] }, at => [
    { from: .2, to: at(D.detail), text: '“Detaylı göster”: grafikler ve bütün raporlar.' },
    { from: at(D.detail), to: at(D.chart), text: 'Her rakamın yanında önceki döneme göre değişim.' },
    { from: at(D.chart), to: at(D.channels ?? D.vat ?? 99), text: 'Günlük satış grafiği; bir güne not da yazılabilir.' },
    ...(D.channels !== undefined ? [{ from: at(D.channels), to: at(D.vat ?? 99), text: 'Kanallar: salon ve QR, masasız satış.' }] : []),
    ...(D.vat !== undefined ? [{ from: at(D.vat), to: 99, text: 'KDV dökümü: orana göre satış, matrah ve KDV.' }] : []),
  ]));

  // ===== 4. Ürünler =====
  const U = marks('r4-urunler'), Ut = taps('r4-urunler');
  list.push(screen('c2-urunler', 'r4-urunler', .2, U.end - .3, { step: 4, toc: 'Ürünler ve QR sipariş payı', taps: ['tab', 'cat'] }, at => [
    { from: .2, to: at(Ut.cat.on), text: 'Ürünler: adet, tutar ve satıştaki payı.' },
    { from: at(Ut.cat.on), to: 99, text: 'Kategoriye göre süzülür.' },
  ]));

  // ===== 5. Personel: the QR share =====
  const P = marks('r5-personel'), Pt = taps('r5-personel');
  list.push(screen('c3-personel', 'r5-personel', .2, P.end - .3, { step: 5, taps: ['group'] }, at => [
    { from: .2, to: at(Pt.qr.on), text: 'Personel → Çalışanlar.' },
    { from: at(Pt.qr.on), to: at(Pt.qr.on) + 2.4, text: 'Müşterilerin kendi verdiği siparişler: QR sipariş payı.' },
    { from: at(Pt.qr.on) + 2.4, to: at(Pt.staff.on), text: 'Siparişlerinizin ne kadarını QR ile alıyorsunuz? 30 günde görün.' },
    { from: at(Pt.staff.on), to: 99, text: 'Çalışanların aldığı siparişlerin dağılımı.' },
  ]));

  // ===== 6. Kârlılık, one glance =====
  const K = marks('r6-karlilik');
  list.push(screen('d1-karlilik', 'r6-karlilik', .2, K.end - 1, { step: 6, toc: 'Kârlılık ve kasa kapanışları', taps: ['group', 'tab', 'today'] }, at => [
    { from: .2, to: at(K.profit), text: 'Satış → Kârlılık.' },
    { from: at(K.profit), to: 99, text: 'Satış, malzeme maliyeti, brüt kâr; ürün başına kâr oranı.' },
  ]));

  // ===== 7. Kasa kapanışları =====
  const Z = marks('r7-kapanis'), Zt = taps('r7-kapanis');
  list.push(screen('d2-kapanis', 'r7-kapanis', .2, Z.end - .3, { step: 7, taps: ['nav', 'tab', 'd7', 'open'], gaps: [[Zt.kpis.on + 2.6, Zt.kpis.off!]] }, at => [
    { from: .2, to: at(Z.list), text: 'Kasa ve giderler → Kapanışlar.' },
    { from: at(Z.list), to: at(Zt.cards.on), text: 'Dönemin kapanışları ve toplam kasa farkı.' },
    { from: at(Zt.cards.on), to: at(Z.opened), text: 'Her gün sonu: açılış, beklenen, sayılan nakit ve fark.' },
    { from: at(Z.opened), to: 99, text: 'Beklenen nakit ve fark yalnız işletme sahibinde görünür.' },
  ]));

  // ===== 8. Yazdır ve paylaş =====
  const Y = marks('r8-yazdir'), Yt = taps('r8-yazdir');
  list.push(screen('e1-yazdir', 'r8-yazdir', Yt.share.on - .4, Y.xlsxNote + 2.4, { step: 8, toc: 'Yazdır, PDF ve Excel', taps: ['share', 'print', 'pdf', 'closePrint', 'share2', 'excel', 'xlsx'],
    gaps: [[Yt.page2.on + 1.6, Yt.page2.off!], [Y.pdfNote + 2, Yt.closePrint.on], [Yt.choices.on + 2.4, Yt.choices.off!]] }, at => [
    { from: .2, to: at(Y.menu), text: 'Her raporda “Yazdır ve paylaş” vardır.' },
    { from: at(Y.menu), to: at(Y.preview), text: 'Yazdır / PDF, muhasebeci için Excel, e-posta ve telefon.' },
    { from: at(Y.preview), to: at(Yt.pdf.on), text: 'Ekrandaki raporun A4 sayfası, sayfa numaralı.' },
    { from: at(Yt.pdf.on), to: at(Y.excel), text: '“PDF indir”: dosya bu bilgisayara kaydedilir.' },
    { from: at(Y.excel), to: at(Yt.xlsx.on), text: 'Muhasebeci için tek Excel: satış, gider, kapanış, KDV.' },
    { from: at(Yt.xlsx.on), to: 99, text: 'Bu ay, geçen ay ya da başka bir ay seçilir.' },
  ]));

  // ===== 9. The setting: POS komisyon oranı, full screen; its effect the next day; before / after =====
  const S = marks('s1-pos'), St = taps('s1-pos');
  const f1 = holdEnd(setting('f1-pos', 's1-pos', .2, S.end - .2, 9, ['nav', 'tab', 'part', '!rate'], at => [
    { from: .2, to: at(S.card), text: 'Ayar: Kasa ve giderler → Kasa ayarları → Kart ve yazar kasa.' },
    { from: at(S.card), to: at(St.rate.on), text: '“Elde kalan” hesaplanırken kart ödemelerinden düşülür.' },
    { from: at(St.rate.on), to: at(S.typed), text: 'POS komisyon oranı: bankanın oranı yazılır, örneğin 1,75.' },
    { from: at(S.typed), to: 99, text: 'Yalnız yeni kart ödemelerine uygulanır. Boşsa komisyon bilinmez.' },
  ], { toc: 'POS komisyonu ve elde kalan', top: true }), 1.5);
  // The app's "Ayarlar kaydedildi" note comes up at the bottom of the window: the camera rests 40 px lower here (y 80–800)
  // and the captions stand at the top left.
  const f1Layer = f1.layers![0] as Extract<Layer, { kind: 'screen' }>;
  f1Layer.cam = f1Layer.cam.map(c => c.w === 1280 ? { ...c, y: 80 } : c);
  list.push(f1);
  const N = marks('s3-sonra'), Nt = taps('s3-sonra');
  list.push(screen('f2-sonra', 's3-sonra', .2, N.end - .3, { step: 9, taps: ['nav', 'tip'] }, at => [
    { from: .2, to: at(Nt.grid.on), text: 'Ertesi gün: Satış ve Raporlar, Bugün.' },
    { from: at(Nt.grid.on), to: at(N.tip), text: 'Kart komisyonu düşülür; elde kalan artık “geçici” değil.' },
    { from: at(N.tip), to: 99, text: 'Dökümü: satış − giderler − iadeler − kart komisyonu.' },
  ]));
  // The Elde kalan card of both days, a little air around it (the same window height on both sides).
  const pad = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x - 16, y: b.y - 26, width: b.width + 32, height: b.height + 52 });
  const before = pad(At.kept.box), after = { ...pad(Nt.kept.box), height: before.height };
  list.push(screenSplitScene('f3-karsilastirma', 'POS komisyon oranı: elde kalan', 'Satış ve Raporlar · Bugün',
    { clip: 'r1-bugun', t: At.kept.on + 1.5, label: 'Varsayılan · oran boş', region: before },
    { clip: 's3-sonra', t: Nt.kept.on + 1.5, label: 'Oran %1,75 · ertesi gün', region: after },
    'Oran boşken elde kalan geçicidir; girilince kart komisyonu düşülür.', 8));

  // ===== 10. The setting: Raporları gönder, full screen; what arrives =====
  const E = marks('s2-eposta'), Et = taps('s2-eposta');
  list.push(setting('g1-eposta', 's2-eposta', Et.nav.tap! + 1, Et.facts.off! - .2, 10, ['nav', 'share', '!send', 'to', 'save', 'day', 'week', 'month'], at => [
    { from: .2, to: at(Et.send.on), text: 'Ayar: Satış ve Raporlar → “Yazdır ve paylaş”.' },
    { from: at(Et.send.on), to: at(E.modal), text: '“Raporları gönder”.' },
    { from: at(E.modal), to: at(Et.to.on), text: 'Raporlar işletmenin kendi e-posta hesabından gönderilir.' },
    { from: at(Et.to.on), to: at(E.which), text: 'Raporların gideceği adresler yazılır, en fazla 5.' },
    { from: at(E.which), to: at(E.on), text: 'Hangi raporlar gelsin: gün sonu, haftalık, aylık, yıllık.' },
    { from: at(E.on), to: at(E.facts), text: 'Gün sonu raporu kapanıştan hemen sonra gönderilir.' },
    { from: at(E.facts), to: 99, text: 'İçinde satış, gider, kasa farkı ve değişim; ekinde PDF.' },
  ], { toc: 'E-posta raporları ve telefon', gaps: [[Et.savedNote.on + 1.4, Et.savedNote.off!], [Et.switches.on + 1.8, Et.switches.off!]] }));
  const G = marks('s4-gelen'), Gt = taps('s4-gelen');
  list.push(screen('g2-gelen', 's4-gelen', .2, Gt.recent.off! - .1, { step: 10, taps: ['bell', 'nav', 'share', 'send'] }, at => [
    { from: .2, to: at(G.inbox), text: 'Gün sonu kapanınca rapor e-postayla gelir.' },
    { from: at(G.inbox), to: at(Gt.nav.on), text: 'Aynı özet Bildirimler’e de düşer.' },
    { from: at(Gt.nav.on), to: at(G.sent), text: '“Raporları gönder”de son gönderimler listelenir.' },
    { from: at(G.sent), to: 99, text: 'Gün sonu raporu: gönderildi.' },
  ]));

  // ===== The owner's phone =====
  const T = marks('p1-telefon');
  list.push({ ...guestScene('h1-telefon', 'p1-telefon', .2, T.end - .2, [], at => [
    { from: .2, to: at(T.closing), text: 'Telefonda da:<br>“İşletmemi yönet”.' },
    { from: at(T.closing), to: at(T.month), text: 'Bugünün satışı ve<br>son kasa kapanışı.' },
    { from: at(T.month), to: 99, text: 'Son 30 gün,<br>internet olan her yerden.' },
  ]), tag: 'İşletme sahibi <b>· Telefon</b>', side: 'business' });
  list.push({ name: 'i0-son', duration: 7.5, card: endCard });
  return list;
}

// ---------- Description and thumbnail ----------
function description(list: Scene[]) {
  const { lines, total } = chapters(list);
  const title = 'Raporlar: günün özeti, kasa kapanışı ve e-posta raporu | Mola';
  if (title.length > 70) throw new Error(`Başlık ${title.length} karakter.`);
  const text = `BAŞLIK (${title.length} karakter)
${title}

AÇIKLAMA
Bu videoda Mola adisyon ve QR menü sisteminde işletme sahibinin raporları gösteriliyor. Görüntüler uygulamanın kendisinden, örnek bir işletmeyle kaydedildi.

Videoda:
- Satış ve Raporlar: günün tek cümlelik özeti; satış, giderler, elde kalan, sipariş; en çok kazandıran ürünler ve kasada olması gereken nakit.
- Dönem seçimi (Bugün, 7 gün, 30 gün, Yıl) ve önceki döneme göre değişim. Biten her yıl kendi dosyasına alınır.
- Detaylı rapor: günlük satış grafiği, kanallar (salon ve QR, masasız), KDV dökümü.
- Ürünler; Personel → Çalışanlar: müşterilerin kendi verdiği siparişler (QR sipariş payı) ve çalışanların sipariş dağılımı.
- Kârlılık (kısaca) ve Kasa ve giderler → Kapanışlar: açılış, beklenen, sayılan nakit ve fark. Beklenen nakit ve fark yalnız işletme sahibinde görünür.
- Yazdır ve paylaş: raporun A4 sayfası, PDF indir ve muhasebeci için Excel dosyası.
- Ayar: Kasa ve giderler → Kasa ayarları → Kart ve yazar kasa → POS komisyon oranı. Yalnız yeni kart ödemelerine uygulanır; oran boşken elde kalan "geçici" görünür. Önce / sonra karşılaştırmasıyla.
- Ayar: Satış ve Raporlar → Yazdır ve paylaş → Raporları gönder. Raporlar işletmenin kendi e-posta hesabından gönderilir; gün sonu, haftalık, aylık ve yıllık rapor seçilir. Gün sonu raporu kapanıştan sonra gelir, ekinde PDF vardır; özeti Bildirimler'e de düşer.
- Telefonda İşletmemi yönet: bugünün satışı, son kasa kapanışı ve son 30 gün.

Bölümler
${lines.join('\n')}

Mola 30 gün ücretsiz denenebilir.
Web: https://molayazilim.com.tr
E-posta: destek@molayazilim.com.tr

ETİKETLER
Mola, Mola adisyon, satış raporu, kafe raporu, restoran raporu, gün sonu raporu, kasa kapanışı, e-posta raporu, QR sipariş, POS komisyonu, muhasebe Excel, adisyon programı, kafe yazılımı, Elazığ
`;
  writeFileSync(join(dirs.out, 'aciklama.txt'), text.replace(/\n/g, '\r\n'));
  console.log(lines.join('\n'), `\nToplam ${fmt(total)} (${total.toFixed(1)} sn)`);
}
/** The round badge of the thumbnail: a bar chart (Raporlar). */
const reportBadge = `<svg viewBox="0 0 24 24" width="70" height="70" fill="none" stroke="${C.green}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>`;
async function thumbnail(browser: Browser) {
  // The owner's İşletmemi yönet on the phone (Bugünün satışı on top), shot off camera by the recorder.
  await shootThumb(browser, introThumb({ title: 'Satış ve<br>Raporlar', shot: join(dirs.rec, 'kapak-telefon.png'), badge: reportBadge }));
}

await uret({ mp4: 'Raporlar.mp4', music: MUSIC, description, thumbnail, scenes,
  stillsAt: process.env.KARE_SIK ? (s => Array.from({ length: Math.ceil(s.duration / 2) }, (_, i) => Math.min(s.duration - .05, i * 2 + .6))) : undefined });
