/*
 * YouTube E1 "Garson eğitimi" (training series: the owner tells a new waiter "watch this"): the 1920×1080 video, kapak.jpg
 * and aciklama.txt from the recordings of scripts/sosyal/youtube-garson-kayit.ts, on the shared stage of
 * scripts/sosyal/youtube-sahne.ts (as videos 01 and 06). No voice-over: captions and the music of scripts/sosyal/muzik.py
 * (cesit-1, soft breaks at the chapters), -20 LUFS.
 *
 *   npx tsx scripts/sosyal/youtube-garson-kurgu.ts              everything (scenes → video → music → kapak.jpg, aciklama.txt)
 *   npx tsx scripts/sosyal/youtube-garson-kurgu.ts c1 e1        only these scenes again (then the video is joined again)
 *   npx tsx scripts/sosyal/youtube-garson-kurgu.ts --kare       a few stills per scene (layout check), no video
 *   npx tsx scripts/sosyal/youtube-garson-kurgu.ts --kapak      only the thumbnail and the description
 *   SOSYAL_CIKTI=<klasör> …                                     another output folder
 *
 * The owner's rules (18 Ekim): the logo opening, then "Garson eğitimi"; only the waiter's own screen, the tablet large, centred
 * and steady; no pointer: an ordinary tap is a soft ripple only; a red outline and a slight 1.2× move at most once per step,
 * only where something small must be found; a linear story, waits cut silently; a label at the top right "Garson tableti ·
 * Adım n / 9" ("Mutfak ekranı" once, briefly, where the order lands); plain imperative captions; the closing card with
 * molayazilim.com.tr and "Mola eğitim serisi".
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import sharp from 'sharp';
import { C, ROOT, base, chapters, dirs, endCardWith, frameFile, img, introCard, mark, marks, shootThumb, staffScene, taps, uret, yer, type Caption, type CaptionsOf, type Scene, type TimeMap } from './youtube-sahne';

yer({ rec: join(ROOT, '.local', 'sosyal', 'youtube', 'garson', 'kayit'), work: join(ROOT, '.local', 'sosyal', 'youtube', 'garson', 'kurgu'),
  out: resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola YouTube', 'E1 Garson eğitimi')) });
const STEPS = 9;
const side = (who: string) => `${who} <b>· Adım {adim} / ${STEPS}</b>`;
const stepped = (n: number, list: Caption[]) => list.map(c => ({ step: n, ...c }));
/** The waiter's tablet (or the kitchen screen, once), every caption carrying the step for the top-right label. */
function tablet(name: string, clip: string, from: number, to: number, o: { step: number; taps?: string[]; gaps?: [number, number][]; toc?: string; kitchen?: boolean }, captions: CaptionsOf): Scene {
  return staffScene(name, clip, from, to, { frame: o.kitchen ? 'display' : 'tablet', tag: side(o.kitchen ? 'Mutfak ekranı' : 'Garson tableti'), taps: o.taps, gaps: o.gaps },
    (at, d) => stepped(o.step, captions(at, d)), o.toc);
}
/** A clip without taps held still at some moments (clip time, extra seconds): time to read about a screen that stands. */
function held(scene: Scene, from: number, to: number, holds: [number, number][], captions: CaptionsOf, step: number) {
  const list = [...holds].sort((a, b) => a[0] - b[0]), map: TimeMap = [[0, from]];
  let extra = 0;
  for (const [h, e] of list) { map.push([h - from + extra, h], [h - from + extra + e, h]); extra += e; }
  const d = to - from + extra;
  map.push([d, to]);
  const at = (c: number) => c - from + list.filter(([h]) => h < c).reduce((n, [, e]) => n + e, 0);
  const layer = scene.layers![0] as Extract<NonNullable<Scene['layers']>[number], { kind: 'screen' }>;
  layer.map = map;
  return { ...scene, duration: d, captions: stepped(step, captions(at, d)) };
}

function scenes(): Scene[] {
  const list: Scene[] = [];
  list.push({ name: 'a0-giris', duration: 8, card: introCard('Garson eğitimi', 'Garson tabletinde günlük işler, adım adım.'), toc: 'Giriş ve Masalar' });

  // ===== 1. Sign in =====
  const G = marks('g1-giris'), Gt = taps('g1-giris');
  list.push(tablet('b1-giris', 'g1-giris', -1.6, G.end - .2, { step: 1, taps: ['user', 'pass', 'open'] }, at => [
    { from: .2, to: at(Gt.user.on), text: 'Hesabınızı işletme sahibi açar.' },
    { from: at(Gt.user.on), to: at(Gt.open.on), text: 'Kullanıcı adınızı ve şifrenizi yazın.' },
    { from: at(Gt.open.on), to: at(G.in), text: '“Çalışma alanını aç”a dokunun.' },
    { from: at(G.in), to: 99, text: 'Masalar ekranı açılır.' },
  ]));

  // ===== 2. Masalar: the table states =====
  const M = marks('g2-masalar');
  list.push(held(tablet('b2-masalar', 'g2-masalar', .2, M.end - .2, { step: 2 }, () => []), .2, M.end - .2,
    [[.4, 1.6], [M.grid + .4, 3.2], [M.bahce + .4, 3.0], [M.teras + .4, 1.2]], at => [
      { from: .2, to: at(M.grid) - .9, text: 'Masalar: salondaki bütün masalar ve durumları.' },
      { from: at(M.grid) - .5, to: at(M.grid) + 2.7, text: 'Her kartın üstünde masanın durumu yazar.<br>Boş masa sade renktedir.' },
      { from: at(M.grid) + 2.7, to: at(M.bahce) - .9, text: 'Yeşil: siparişler teslim edildi, hesap açık.<br>Sarı: “Servise hazır”, “Yeni sipariş”, “Hazırlanıyor”.' },
      { from: at(M.bahce) - .5, to: at(M.teras) - .9, text: 'Pembe: masa temizlik bekliyor.' },
      { from: at(M.teras) - .5, to: 99, text: 'Açık masanın kartında sipariş sayısı<br>ve kalan hesap yazar.' },
    ], 2));

  // ===== 3. An order =====
  const S = marks('g3-siparis'), St = taps('g3-siparis');
  list.push(tablet('c1-siparis', 'g3-siparis', .2, S.sent + 2.6, { step: 3, toc: 'Sipariş alma',
    taps: ['table', 'add', 'cat', 'p0', 'sugar', 'more', 'note', 'add0', 'all', 'search', 'p1', 'add1', 'cart', 'send'] }, at => [
    { from: .2, to: at(S.composer), text: 'Masaya dokunun, sonra “Sipariş ekle”.' },
    { from: at(S.composer), to: at(St.cat.on), text: '“Sipariş al” açılır; masa seçili gelir.' },
    { from: at(St.cat.on), to: at(St.sugar.on), text: 'Kategoriye, sonra ürüne dokunun.' },
    { from: at(St.sugar.on), to: at(St.note.on), text: 'Seçeneği işaretleyin; “+” ile adedi artırın.' },
    { from: at(St.note.on), to: at(St.all.on), text: 'Gerekirse not yazın, “Sepete ekle”.' },
    { from: at(St.all.on), to: at(St.cart.on), text: 'Ürünü adıyla da arayabilirsiniz.' },
    { from: at(St.cart.on), to: at(St.send.on), text: 'Alttaki çubuk sepeti açar; ürünleri kontrol edin.' },
    { from: at(St.send.on), to: 99, text: '“Siparişi gönder”: sipariş mutfağa gider.' },
  ]));
  const K = marks('g3-mutfak');
  list.push(tablet('c2-mutfak', 'g3-mutfak', K.ticket - .9, K.ticket + 3.6, { step: 3, kitchen: true }, () => [
    { from: .2, to: 99, text: 'Sipariş mutfak ekranına düşer.' },
  ]));

  // ===== 4. A QR order waiting for approval =====
  const O = marks('g4-onay'), Ot = taps('g4-onay');
  list.push(tablet('d1-onay', 'g4-onay', .2, O.approved + 1.8, { step: 4, toc: 'QR onayı ve garson çağrısı', taps: ['approve'], gaps: [[O.wait0 + .4, O.arrived - .5]] }, at => [
    { from: .2, to: at(Ot.queue.on), text: 'Garson onayı açıksa müşterinin QR siparişi önce size gelir.' },
    { from: at(Ot.queue.on), to: at(Ot.reject.on), text: '“QR sipariş onayları”nda masayı ve ürünleri kontrol edin.' },
    { from: at(Ot.reject.on), to: at(Ot.approve.on), text: 'Yanlışsa “Reddet”: müşteriye kısa bir açıklama yazılır.' },
    { from: at(Ot.approve.on), to: 99, text: '“Onayla ve mutfağa gönder”: sipariş mutfağa gider.' },
  ]));

  // ===== 5. A waiter call =====
  const W = marks('g5-cagri'), Wt = taps('g5-cagri');
  list.push(tablet('d2-cagri', 'g5-cagri', .2, W.closed + 1.6, { step: 5, taps: ['!close'], gaps: [[W.wait0 + .3, W.chip - .5]] }, at => [
    { from: .2, to: at(Wt.close.on), text: 'Müşteri “Garson çağır”a basınca çağrı ekranın üstünde<br>masa adıyla görünür; tablet ses verir.' },
    { from: at(Wt.close.on), to: 99, text: 'Masaya gidin; sonra “Tamam” ile çağrıyı kapatın.' },
  ]));

  // ===== 6. Ready → served =====
  const R = marks('g6-hazir'), Rt = taps('g6-hazir');
  list.push(tablet('e1-hazir', 'g6-hazir', .2, R.served + 1.8, { step: 6, toc: 'Servise hazır ve teslim', taps: ['!nav', 'served'], gaps: [[R.wait0 + .3, R.ready - .6]] }, at => [
    { from: .2, to: at(Rt.nav.on), text: 'Mutfak siparişi hazırlayınca tablette kısa bir not çıkar.' },
    { from: at(Rt.nav.on), to: at(R.list), text: '“Servise hazır”daki sayı, götürülecek siparişleri gösterir.' },
    { from: at(R.list), to: at(Rt.served.on), text: 'Siparişi masaya götürün.' },
    { from: at(Rt.served.on), to: 99, text: 'Sonra “Teslim edildi”ye dokunun.' },
  ]));

  // ===== 7. More for an open table =====
  const E = marks('g7-ekle'), Et = taps('g7-ekle');
  list.push(tablet('f1-ekle', 'g7-ekle', .2, E.sent + 2.2, { step: 7, toc: 'Açık masaya ekleme ve masa taşıma', taps: ['table', 'add', 'cat', 'p0', 'p0b', 'send'] }, at => [
    { from: .2, to: at(Et.bill.on), text: 'Açık masaya ekleme: masaya dokunun.' },
    { from: at(Et.bill.on), to: at(Et.add.on), text: 'Masanın siparişleri ve kalan hesabı görünür.' },
    { from: at(Et.add.on), to: at(Et.p0.on), text: '“Sipariş ekle”: aynı masaya yeni ürün eklenir.' },
    { from: at(Et.p0.on), to: at(Et.send.on), text: 'Seçeneksiz üründe “+” bir adet ekler.' },
    { from: at(Et.send.on), to: 99, text: 'Alttaki “Gönder” siparişi doğrudan mutfağa gönderir.' },
  ]));

  // ===== 8. Move the bill =====
  const T = marks('g8-tasi'), Tt = taps('g8-tasi');
  list.push(tablet('f2-tasi', 'g8-tasi', .2, T.end - .2, { step: 8, taps: ['table', 'move', 'select', 'confirm'] }, at => [
    { from: .2, to: at(Tt.move.on), text: 'Müşteriler masa değiştirirse masaya dokunun.' },
    { from: at(Tt.move.on), to: at(Tt.select.on), text: '“Taşı / birleştir”: hesap ve siparişler yeni masaya geçer.' },
    { from: at(Tt.select.on), to: at(Tt.confirm.on), text: 'Hedef masayı seçin. Dolu bir masa seçilirse iki hesap birleşir.' },
    { from: at(Tt.confirm.on), to: 99, text: '“Hesabı taşı”: hesap Masa 08’e geçer; eski masa temizlik bekler.' },
  ]));

  // ===== 9. The bill and the cleaning =====
  const H = marks('g9-hesap'), Ht = taps('g9-hesap');
  list.push(tablet('g1-hesap', 'g9-hesap', .2, H.clean + 2.4, { step: 9, toc: 'Hesap ve temizlik', taps: ['!chip', 'close', 'table', 'cleaned'],
    gaps: [[H.wait0 + .3, H.chip - .5], [H.pay0 + .4, H.paid - .1]] }, at => [
    { from: .2, to: at(Ht.chip.on) + .2, text: 'Müşteri hesabı isteyince ekranda bir hesap isteği çıkar.' },
    { from: at(Ht.chip.on) + .2, to: at(Ht.close.on), text: 'Ödeme şekli yanında yazar: “Kart” ise POS cihazını götürün.' },
    { from: at(Ht.close.on), to: at(H.closed) + .6, text: 'Sonra “Tamam” ile isteği kapatın.' },
    { from: at(H.closed) + .6, to: at(H.cleaning) - .3, text: 'Ödemeyi kasa alır.' },
    { from: at(H.cleaning), to: at(Ht.table.on), text: 'Ödeme alınınca masa “Temizlik bekliyor” olur.' },
    { from: at(Ht.table.on), to: at(H.clean), text: 'Masayı toplayın; “Temizlendi · Masayı hazırla”ya dokunun.' },
    { from: at(H.clean), to: 99, text: 'Masa yeniden siparişe açılır.' },
  ]));
  list.push({ name: 'h0-son', duration: 7.5, card: endCardWith('Mola eğitim serisi') });
  return list;
}

// ---------- Description and thumbnail ----------
function description(list: Scene[]) {
  const { lines } = chapters(list);
  const title = 'Garson eğitimi: tablette sipariş, onay, çağrı ve servis | Mola';
  if (title.length > 70) throw new Error(`Başlık ${title.length} karakter.`);
  const text = `BAŞLIK (${title.length} karakter)
${title}

AÇIKLAMA
Mola adisyon ve QR menü sisteminde garsonun tabletteki günlük işleri adım adım gösteriliyor. Görüntüler uygulamanın kendisinden, örnek bir işletmeyle kaydedildi. Garson hesabını işletme sahibi açar.

Adımlar:
1. Giriş: kullanıcı adı ve şifre → Çalışma alanını aç.
2. Masalar: masa kartları ve durumları (Boş, Yeni sipariş, Hazırlanıyor, Servise hazır, Teslim edildi, Temizlik bekliyor).
3. Sipariş alma: masa → Sipariş ekle → kategori, ürün, seçenek, adet, not, arama → Siparişi gönder; sipariş mutfak ekranına düşer.
4. QR siparişi onayı (garson onayı açıksa): QR sipariş onayları → Onayla ve mutfağa gönder ya da Reddet.
5. Garson çağrısı: çağrı ekranın üstünde görünür → Tamam.
6. Servise hazır: mutfak hazırlayınca not ve sayı → Servise hazır → Teslim edildi.
7. Açık masaya ekleme: masa → Sipariş ekle → Gönder.
8. Masa taşıma ve birleştirme: masa → Taşı / birleştir → hedef masa.
9. Hesap isteği ve temizlik: ödeme şekli hesap isteğinde yazar, ödemeyi kasa alır; sonra Temizlendi · Masayı hazırla.

Bölümler
${lines.join('\n')}

Web: https://molayazilim.com.tr
E-posta: destek@molayazilim.com.tr

ETİKETLER
garson eğitimi, garson tableti, adisyon programı, kafe adisyon, restoran adisyon, sipariş alma, QR sipariş onayı, garson çağırma, servise hazır, masa taşıma, masa birleştirme, Mola, Mola adisyon, Mola eğitim
`;
  writeFileSync(join(dirs.out, 'aciklama.txt'), text.replace(/\n/g, '\r\n'));
  console.log(lines.join('\n'));
}
function thumbHtml() {
  const shot = join(dirs.work, 'kapak-masalar.png');
  return base(1280, 720, `
  <div class="left"><small>EĞİTİM</small><h1 class="serif">Garson<br>eğitimi</h1><p>Tablette sipariş, onay,<br>çağrı ve servis.</p>
    <div class="brand">${mark(60)}<span class="serif">mola<i>.</i></span></div></div>
  <div class="tab"><div class="screen"><img src="${img(shot)}"></div></div>`, `
  body{background:radial-gradient(80% 90% at 25% 40%,#2a5848 0%,${C.green} 58%,#1d4134 100%);color:${C.cup}}
  .left{position:absolute;left:64px;top:0;bottom:0;width:520px;display:flex;flex-direction:column;justify-content:center}
  .left small{font:700 24px/1 'Segoe UI',system-ui,sans-serif;letter-spacing:.3em;color:rgba(207,224,211,.9)}
  h1{margin-top:18px;font-weight:400;font-size:118px;line-height:.98;letter-spacing:-.03em}
  .left p{margin-top:24px;font:600 32px/1.25 'Segoe UI',system-ui,sans-serif;color:rgba(243,235,221,.9)}
  .brand{display:flex;align-items:center;gap:16px;margin-top:36px;font-size:48px}.brand svg{border-radius:14px;box-shadow:0 0 0 2px rgba(243,235,221,.3)}.brand i{font-style:normal;color:${C.dot}}
  .tab{position:absolute;left:600px;top:130px;width:700px;padding:16px;border-radius:30px;background:#1c2721;box-shadow:0 40px 80px -20px rgba(0,0,0,.55),inset 0 0 0 2px #3a4a41;transform:rotate(-3deg)}
  .tab .screen{border-radius:14px;overflow:hidden;background:${C.paper}}.tab img{display:block;width:100%}`);
}
async function thumbnail(browser: Browser) {
  // The waiter's Masalar: the table cards and their states (İç salon).
  const M = marks('g2-masalar');
  await sharp(frameFile('g2-masalar', M.grid + .5)).resize(1180).png().toFile(join(dirs.work, 'kapak-masalar.png'));
  await shootThumb(browser, thumbHtml());
}

await uret({ mp4: 'Garson eğitimi.mp4', music: 'cesit-1', description, thumbnail, scenes,
  stillsAt: process.env.KARE_SIK ? (s => Array.from({ length: Math.ceil(s.duration / 2) }, (_, i) => Math.min(s.duration - .05, i * 2 + .6))) : undefined });
