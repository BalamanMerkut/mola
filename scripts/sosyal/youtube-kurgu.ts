/*
 * YouTube pilot 1 "QR menü ve QR sipariş" (sürüm 2, 18 Ekim): the 1920×1080 video, its thumbnail and description, made from
 * the recordings of scripts/sosyal/youtube-qr-kayit.ts. No voice-over: captions and the background music of
 * scripts/sosyal/muzik.py (canli-uzun).
 *
 *   npx tsx scripts/sosyal/youtube-kurgu.ts                everything (scenes → video → music → kapak.jpg, aciklama.txt)
 *   npx tsx scripts/sosyal/youtube-kurgu.ts b2 c3          only these scenes again (then the video is joined again)
 *   npx tsx scripts/sosyal/youtube-kurgu.ts --kare         a few stills per scene (layout check), no video
 *   npx tsx scripts/sosyal/youtube-kurgu.ts --kapak        only the thumbnail and the description
 *   SOSYAL_CIKTI=<klasör> …                                another output folder
 *
 * The owner's rules (18 Ekim): one linear story, one subject on screen at a time (the only exception: the before/after split
 * after each setting); no pointer and steady framing (sürüm 3): an ordinary tap shows only a soft touch ripple; a red outline
 * and a slight (1.2×) camera move only on the setting's own switch or field; a label at the top right says whose screen it is and the guest's step; no speed notes;
 * plain captions that only say what happens; a closing report scene (QR sipariş payı). Opening: the word "mola" and its dot gliding in from the start of the word.
 *
 * The stage, scene builders, rendering and music joining are shared with the other YouTube videos (scripts/sosyal/youtube-sahne.ts):
 * every scene is an HTML stage drawn for every frame at 30 fps from the recorded frames, each frame a screenshot piped to
 * ffmpeg, then joined (same encoding, stream copy) and given the music: H.264 High, yuv420p BT.709, AAC 48 kHz, -20 LUFS.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import sharp from 'sharp';
import { C, ROOT, base, chapters, dirs, endCard, img, introCard, mark, marks, meta, ownerScene, guestScene, setGuestSteps, shootThumb, splitScene, staffScene, taps, uret, yer, type Scene } from './youtube-sahne';

yer({ rec: join(ROOT, '.local', 'sosyal', 'youtube', 'kayit'), work: join(ROOT, '.local', 'sosyal', 'youtube', 'kurgu'),
  out: resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola YouTube', '01 QR menü ve QR sipariş')) });
const REC = dirs.rec, WORK = dirs.work, OUT = dirs.out;
const opening = introCard('QR menü ve QR sipariş', 'Misafirin telefonu, işletmenin ekranları ve bunları belirleyen ayarlar.');

function scenes(): Scene[] {
  const list: Scene[] = [];
  // ===== Opening: the logo =====
  list.push({ name: 'a0-giris', duration: 8, card: opening, toc: 'Giriş ve QR sipariş' });

  // ===== 1. Default settings: the guest orders =====
  const A = marks('a-siparis'), At = taps('a-siparis');
  list.push(guestScene('a1-siparis', 'a-siparis', .2, A.sent + 2.8, ['plus', 'sugar', 'add', 'cart', 'send'], at => [
    { from: 0, to: at(A.menu) + .3, step: 1, text: 'Misafir masadaki QR kodu<br>telefonun kamerasıyla okutur.' },
    { from: at(A.menu) + .4, to: at(At.plus.on), step: 2, text: 'Menü tarayıcıda açılır.<br>Uygulama yüklenmez.' },
    { from: at(At.plus.on), to: at(At.sugar.on), step: 3, text: 'Üründeki “+”<br>ürünü açar.' },
    { from: at(At.sugar.on), to: at(At.add.on), step: 3, text: 'Seçenek belirlenir:<br>şeker “Orta”.' },
    { from: at(At.add.on), to: at(At.cart.on), step: 3, text: '“Sepete ekle” ürünü<br>sepete koyar.' },
    { from: at(At.cart.on), to: at(At.send.on), step: 4, text: '“Sepetimi görüntüle”<br>sepeti açar.' },
    { from: at(At.send.on), to: at(A.sent), step: 5, text: '“Siparişi gönder” siparişi<br>işletmeye iletir.' },
    { from: at(A.sent), to: 999, step: 5, text: 'Sipariş alındı;<br>numarası ekranda görünür.' },
  ]));
  list.push(staffScene('a2-mutfak', 'a-mutfak', A.sent - 1.2, A.sent + 4.6, { frame: 'display', tag: 'İşletme tarafı <b>· Mutfak ekranı</b>' }, () => [
    { from: .2, to: 99, text: 'Varsayılan ayarlarda sipariş<br>mutfak ekranına hemen düşer.' },
  ]));
  list.push(guestScene('a3-siparislerim', 'a-siparis', At.track.on - .4, A.end - .2, ['track', 'order'], at => [
    { from: 0, to: at(At.order.on), step: 6, text: '“Siparişimi takip et”<br>“Siparişlerim”i açar.' },
    { from: at(At.order.on), to: 999, step: 6, text: 'Siparişin durumu ve<br>masanın hesabı burada görünür.' },
  ]));

  // ===== 2. Müşteri siparişini değiştirip iptal edebilsin =====
  const S = taps('a-ayar-sure'), Sm = marks('a-ayar-sure');
  list.push(ownerScene('b1-ayar-sure', 'a-ayar-sure', .1, Sm.end - .2, ['ayarlar', 'topic', '!toggle', '!seconds'], at => [
    { from: .2, to: at(S.ayarlar.on), text: 'Misafirin sipariş ekranı işletmenin ayarlarına göre değişir.' },
    { from: at(S.ayarlar.on), to: at(S.row.on), text: 'Ayarlar → Sipariş ve mutfak → Sipariş ve onay.' },
    { from: at(S.row.on), to: at(S.seconds.on), text: '“Müşteri siparişini değiştirip iptal edebilsin” açılır.' },
    { from: at(S.seconds.on), to: 999, text: 'Süre 30 saniye olarak gelir; 1–600 saniye arası yazılabilir.' },
  ], 'Ayar: sipariş değiştirme süresi'));
  const B = marks('b-degistir'), Bt = taps('b-degistir');
  list.push(guestScene('b2-degistir', 'b-degistir', .3, (Bt.cancel?.off ?? B.changed + 3) + .6, ['plus', 'add', 'cart', 'send', 'window', 'track', 'change', 'qty', 'save', 'cancel'], at => [
    { from: 0, to: at(Bt.send.on), step: 7, text: 'Ayar açıkken misafir<br>aynı siparişi verir.' },
    { from: at(Bt.send.on), to: at(Bt.window.on), step: 7, text: 'Sipariş gönderilir.' },
    { from: at(Bt.window.on), to: at(Bt.track.on), step: 7, text: 'Onay ekranı değiştirme<br>süresini gösterir: 30 sn.' },
    { from: at(Bt.track.on), to: at(Bt.change.on), step: 7, text: '“Siparişlerim”de “Siparişi<br>değiştir” geri sayımla görünür.' },
    { from: at(Bt.change.on), to: at(Bt.save.on), step: 7, text: 'Misafir adedi<br>2 yapar.' },
    { from: at(Bt.save.on), to: Bt.cancel ? at(Bt.cancel.on) : 999, step: 7, text: '“Değişiklikleri kaydet”<br>siparişi günceller.' },
    ...(Bt.cancel ? [{ from: at(Bt.cancel.on), to: 999, step: 7, text: 'Süre içinde “Siparişi iptal et”<br>de kullanılabilir.' }] : []),
  ]));
  list.push(staffScene('b3-mutfak', 'b-mutfak', B.kitchen - 1.6, B.kitchen + 4.4, { frame: 'display', tag: 'İşletme tarafı <b>· Mutfak ekranı</b>' }, () => [
    { from: .2, to: 99, text: 'Mutfak ekranı siparişi<br>süre dolunca alır.' },
  ]));
  list.push(splitScene('b4-karsilastirma', 'Müşteri siparişini değiştirip iptal edebilsin',
    { clip: 'a-siparis', t: At.order.on + .3, label: 'Varsayılan · kapalı' }, { clip: 'b-degistir', t: Bt.track.tap! + .9, label: 'Açık · 30 sn', play: Math.min(2.5, Bt.change.tap! - Bt.track.tap! - 1.1) },
    'Kapalıyken değiştirme düğmesi yoktur; açıkken süre boyunca görünür.'));

  // ===== 3. QR siparişlerinde garson onayı =====
  const O = taps('c-ayar-onay'), Om = marks('c-ayar-onay');
  list.push(ownerScene('c1-ayar-onay', 'c-ayar-onay', .1, Om.end - .2, ['ayarlar', 'topic', '!toggle'], at => [
    { from: .2, to: at(O.ayarlar.on), text: 'Sonraki örnekte değiştirme süresi kapalıdır.' },
    { from: at(O.ayarlar.on), to: at(O.row.on), text: 'Ayarlar → Sipariş ve mutfak → Sipariş ve onay.' },
    { from: at(O.row.on), to: 999, text: '“QR siparişlerinde garson onayı” açılır.' },
  ], 'Ayar: garson onayı'));
  const Cm = marks('c-onay'), Ct = taps('c-onay');
  list.push(guestScene('c2-onay-misafir', 'c-onay', .3, Ct.waiting.off! + .5, ['plus', 'add', 'cart', 'send', 'waiting'], at => [
    { from: 0, to: at(Ct.send.on), step: 8, text: 'Misafir siparişini<br>hazırlar.' },
    { from: at(Ct.send.on), to: at(Ct.waiting.on), step: 8, text: 'Sipariş gönderilir.' },
    { from: at(Ct.waiting.on), to: 999, step: 8, text: 'Sipariş önce garsonun<br>onayına gider.' },
  ]));
  const Gt = taps('c-garson');
  list.push(staffScene('c3-onay-tablet', 'c-garson', Gt.queue.on - 1.2, Gt.approve.tap! + 1.8, { frame: 'tablet', tag: 'İşletme tarafı <b>· Garson tableti</b>', taps: ['approve'] }, at => [
    { from: .2, to: at(Gt.approve.on), text: 'Garson tabletinde onay bekleyen sipariş görünür.' },
    { from: at(Gt.approve.on), to: 99, text: '“Onayla ve mutfağa gönder” siparişi mutfağa geçirir.' },
  ]));
  list.push(guestScene('c4-onay-misafir', 'c-onay', Cm.approved - .4, Ct.ok.off! + .2, ['ok'], () => [
    { from: .1, to: 999, step: 8, text: 'Misafirin ekranında<br>“Onaylandı, hazırlanıyor” yazar.' },
  ]));
  list.push(splitScene('c5-karsilastirma', 'QR siparişlerinde garson onayı',
    { clip: 'a-siparis', t: A.sent + 1.6, label: 'Varsayılan · kapalı' }, { clip: 'c-onay', t: Ct.waiting.on + .3, label: 'Açık' },
    'Kapalıyken sipariş doğrudan alınır; açıkken önce garson onaylar.'));

  // ===== 4. QR siparişlerini durdur =====
  const Q = taps('d-ayar-qr'), Qm = marks('d-ayar-qr');
  list.push(ownerScene('d1-durdur', 'd-ayar-qr', .1, Qm.guestFrom + .1, ['!card', 'stop', 'confirm'], at => [
    { from: .2, to: at(Q.stop.on), text: 'Kenar çubuğundaki kart QR siparişlerinin durumunu gösterir.' },
    { from: at(Q.stop.on), to: at(Q.confirm.on), text: '“Durdur” QR siparişlerini geçici olarak kapatır.' },
    { from: at(Q.confirm.on), to: at(Q.closed.on), text: 'Bir kez daha “Durdur” ile onaylanır.' },
    { from: at(Q.closed.on), to: 999, text: 'Kart “QR siparişleri kapalı” gösterir.' },
  ], 'Ayar: QR siparişlerini durdurma'));
  list[list.length - 1].tag = 'İşletme tarafı <b>· Kenar çubuğu</b>';
  const Dm = marks('d-durdu'), Dt = taps('d-durdu');
  list.push(guestScene('d2-durdu-misafir', 'd-durdu', .3, Dm.end - .2, ['plus', 'add', 'cart', 'notice', 'sendOff'], at => [
    { from: 0, to: at(Dt.cart.on), step: 9, text: 'Menü açık kalır;<br>ürün sepete eklenebilir.' },
    { from: at(Dt.cart.on), to: at(Dt.notice.on), step: 9, text: 'Misafir sepeti açar.' },
    { from: at(Dt.notice.on), to: 999, step: 9, text: 'Sepette “Şu an sipariş almıyoruz”<br>yazar; sipariş gönderilemez.' },
  ]));
  list.push(splitScene('d3-karsilastirma', 'QR siparişleri',
    { clip: 'a-siparis', t: At.send.on + .2, label: 'Açık', tone: 'on' }, { clip: 'd-durdu', t: Dt.sendOff.on + .3, label: 'Durduruldu', tone: 'off' },
    'Açıkken sipariş gönderilir; durdurulunca gönderilemez.'));
  list.push(ownerScene('d4-ac', 'd-ayar-qr', Qm.guestTo + .2, Qm.end - .2, ['reopen'], at => [
    { from: .2, to: 999, text: '“Siparişleri aç” QR siparişlerini yeniden açar.' },
  ]));
  list[list.length - 1].tag = 'İşletme tarafı <b>· Kenar çubuğu</b>';

  // ===== 5. Garson çağır, Hesabı iste =====
  const Em = marks('e-cagri'), Et = taps('e-cagri'), Wt = taps('e-garson'), Kt = taps('e-kasa');
  list.push(guestScene('e1-cagir', 'e-cagri', .3, Em.called + 1.8, ['call'], at => [
    { from: 0, to: at(Em.called), step: 10, text: '“Garson çağır”<br>garsona bildirim gönderir.' },
    { from: at(Em.called), to: 999, step: 10, text: 'Düğme “Garson çağrıldı”<br>olarak görünür.' },
  ], 'Garson çağırma ve hesap isteme'));
  list.push(staffScene('e2-cagri-tablet', 'e-garson', Wt.chip.on - 1, Wt.close.tap! + 1.6, { frame: 'tablet', tag: 'İşletme tarafı <b>· Garson tableti</b>', taps: ['close'] }, at => [
    { from: .2, to: at(Wt.close.on), text: 'Çağrı garson tabletinde masa adıyla görünür.' },
    { from: at(Wt.close.on), to: 99, text: 'Garson ilgilenince çağrıyı kapatır.' },
  ]));
  list.push(guestScene('e3-hesap', 'e-cagri', Em.billFrom - .2, Em.billAsked + 2, ['bill', 'card'], at => [
    { from: 0, to: at(Et.card.on), step: 11, text: '“Hesabı iste”: misafir<br>ödeme şeklini seçer.' },
    { from: at(Et.card.on), to: 999, step: 11, text: '“Kart” seçilir; düğme<br>“Hesap istendi” olur.' },
  ]));
  list.push(staffScene('e4-kasa', 'e-kasa', Kt.chip.on - 1, Kt.tile.off! + .4, { frame: 'window', title: 'Kasa ekranı', tag: 'İşletme tarafı <b>· Kasa ekranı</b>' }, at => [
    { from: .2, to: at(Kt.tile.on), text: 'İstek kasa ekranına düşer; ödeme şekli “Kart” yanında yazar.' },
    { from: at(Kt.tile.on), to: 99, text: 'Masanın kartında hesap isteği işareti görünür.' },
  ]));

  // ===== 6. QR kodlarını yazdır =====
  const Y = taps('f-yazdir'), Ym = marks('f-yazdir');
  list.push(ownerScene('f1-yazdir', 'f-yazdir', .1, Ym.end - .1, ['ayarlar', 'topic', 'part', '!a6'], at => [
    { from: .2, to: at(Y.a6.on), text: 'Ayarlar → Masalar ve QR → QR kodlarını yazdır.' },
    { from: at(Y.a6.on), to: at(Y.paper.on), text: 'Baskı: A4’e 6 ya da 12 QR ya da A6 masa standı.' },
    { from: at(Y.paper.on), to: 999, text: 'Masa standı A4’e 4’lü ya da A6 kâğıda tek basılır.' },
  ], 'QR kodlarını yazdırma'));
  list.push({ name: 'f2-baski', duration: 7, capPos: 'bottom', tag: 'İşletme tarafı <b>· Baskı</b>', side: 'business',
    captions: [{ from: .4, to: 9, text: 'Her masanın kodu, masa adıyla birlikte basılır.' }],
    layers: [
      { kind: 'image', src: img(join(REC, 'baski', 'a4-6.png')), w: 560, keys: [{ t: 0, x: 690, y: 500, s: .96, o: 0 }, { t: .5, x: 690, y: 500, s: 1, o: 1 }] },
      { kind: 'image', src: img(join(REC, 'baski', 'a6-stand.png')), w: 540, keys: [{ t: 0, x: 1250, y: 500, s: .96, o: 0 }, { t: .8, x: 1250, y: 500, s: .96, o: 0 }, { t: 1.3, x: 1250, y: 500, s: 1, o: 1 }] },
    ] });
  // ===== 7. The report: how much of the ordering is done by QR =====
  // The chart card runs below the screen's edge: the outline keeps to the donut and its legend.
  for (const t of meta('g-rapor').taps ?? []) if (t.name === 'donut') t.box = { ...t.box, height: Math.min(t.box.height, 330) };
  const R = taps('g-rapor'), Rm = marks('g-rapor');
  list.push(ownerScene('f3-rapor', 'g-rapor', .1, Rm.end - .1, ['rapor', 'range', 'detail', 'staff', '!donut'], at => [
    { from: .2, to: at(R.donut.on), text: 'Satış ve Raporlar → 30 gün → Personel.' },
    { from: at(R.donut.on), to: 999, text: 'Siparişlerinizin ne kadarını QR ile alıyorsunuz? 30 günde görün.' },
  ], 'Rapor: QR sipariş payı'));
  list[list.length - 1].tag = 'İşletme tarafı <b>· Raporlar</b>';
  list.push({ name: 'g0-son', duration: 7.5, card: endCard });
  return list;
}

// ---------- Description and thumbnail ----------
function description(list: Scene[]) {
  const { lines } = chapters(list);
  const title = 'QR menü ve QR sipariş: misafir, garson, mutfak ve ayarlar | Mola';
  if (title.length > 70) throw new Error(`Başlık ${title.length} karakter.`);
  const text = `BAŞLIK (${title.length} karakter)
${title}

AÇIKLAMA
Bu videoda Mola adisyon ve QR menü sisteminde QR menü ve QR siparişin nasıl çalıştığı adım adım gösteriliyor. Görüntüler uygulamanın kendisinden, örnek bir işletmeyle kaydedildi.

Önce varsayılan ayarlarla bir sipariş: masadaki QR kodun okutulması, menü, ürünün sepete eklenmesi, siparişin gönderilmesi, mutfak ekranı ve “Siparişlerim”.
Ardından misafirin ekranını değiştiren üç ayar; her biri için ayarın yeri, açılması, misafirin yeni ekranı ve önce / sonra karşılaştırması:
- Müşteri siparişini değiştirip iptal edebilsin (değiştirme süresi, 30 saniye)
- QR siparişlerinde garson onayı (garson tableti)
- QR siparişlerini durdurma
Son olarak “Garson çağır” ve “Hesabı iste” (Nakit / Kart) ile bunların garson tabletinde ve kasa ekranında görünmesi, masa QR kodlarının yazdırılması ve Satış ve Raporlar’da QR sipariş payı.

Bölümler
${lines.join('\n')}

Mola 30 gün ücretsiz denenebilir.
Web: https://molayazilim.com.tr
E-posta: destek@molayazilim.com.tr

ETİKETLER
QR menü, QR sipariş, adisyon programı, kafe adisyon, restoran adisyon, kafe yazılımı, masadan sipariş, dijital menü, garson çağırma, garson onayı, mutfak ekranı, kasa programı, Mola, Mola adisyon, Elazığ
`;
  writeFileSync(join(OUT, 'aciklama.txt'), text.replace(/\n/g, '\r\n'));
  console.log(lines.join('\n'));
}
function thumbHtml() {
  const shot = join(WORK, 'kapak-menu.png');
  return base(1280, 720, `
  <div class="left"><h1 class="serif">QR menü<br>ve QR sipariş</h1>
    <div class="brand">${mark(64)}<span class="serif">mola<i>.</i></span></div></div>
  <div class="phone"><div class="screen"><img src="${img(shot)}"></div></div>
  <div class="qr"><svg viewBox="0 0 24 24" width="74" height="74" fill="none" stroke="${C.green}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg></div>`, `
  body{background:radial-gradient(80% 90% at 25% 40%,#2a5848 0%,${C.green} 58%,#1d4134 100%);color:${C.cup}}
  .left{position:absolute;left:70px;top:0;bottom:0;width:690px;display:flex;flex-direction:column;justify-content:center}
  h1{font-weight:400;font-size:120px;line-height:1.0;letter-spacing:-.03em}
  .brand{display:flex;align-items:center;gap:16px;margin-top:46px;font-size:52px}.brand svg{border-radius:14px;box-shadow:0 0 0 2px rgba(243,235,221,.3)}.brand i{font-style:normal;color:${C.dot}}
  .phone{position:absolute;left:820px;top:52px;width:318px;height:672px;padding:12px;border-radius:44px;background:#1c2721;box-shadow:0 40px 80px -20px rgba(0,0,0,.55),inset 0 0 0 2px #3a4a41;transform:rotate(4deg)}
  .phone .screen{width:294px;height:636px;border-radius:33px;overflow:hidden;background:${C.paper}}.phone img{width:100%;display:block}
  .qr{position:absolute;left:744px;top:470px;width:120px;height:120px;border-radius:30px;background:${C.cup};display:grid;place-items:center;box-shadow:0 24px 50px -16px rgba(0,0,0,.55)}`);
}
async function thumbnail(browser: Browser) {
  // The menu as the guest sees it (a phone frame of the recording, top part).
  const m = meta('a-siparis'), mk = marks('a-siparis'), at = mk.menuReady + 2.2;
  const i = m.frames.findLastIndex(x => x.t - m.marks.start <= at);
  await sharp(join(REC, 'a-siparis', m.frames[i].file)).png().toFile(join(WORK, 'kapak-menu.png'));
  await shootThumb(browser, thumbHtml());
}

await uret({ mp4: 'QR menü ve QR sipariş.mp4', music: 'canli-uzun', description, thumbnail,
  scenes: () => { const list = scenes(); setGuestSteps(Math.max(...list.flatMap(s => (s.captions ?? []).map(c => c.step ?? 0)))); return list; } });
