/*
 * YouTube E3 "Mutfak eğitimi" (training series: the owner tells a new kitchen worker "watch this"): the 1920×1080 video,
 * kapak.jpg and aciklama.txt from the recordings of scripts/sosyal/youtube-mutfak-kayit.ts, on the shared stage of
 * scripts/sosyal/youtube-sahne.ts (as E1 "Garson eğitimi" and E2 "Kasiyer eğitimi"). No voice-over: captions and the music of
 * scripts/sosyal/muzik.py (soft breaks at the chapters), -20 LUFS.
 *
 *   npx tsx scripts/sosyal/youtube-mutfak-kurgu.ts              everything (scenes → video → music → kapak.jpg, aciklama.txt)
 *   npx tsx scripts/sosyal/youtube-mutfak-kurgu.ts c1 e1        only these scenes again (then the video is joined again)
 *   npx tsx scripts/sosyal/youtube-mutfak-kurgu.ts --kare       a few stills per scene (layout check), no video
 *   npx tsx scripts/sosyal/youtube-mutfak-kurgu.ts --kapak      only the thumbnail and the description
 *   MUZIK=cesit-7 npx tsx scripts/sosyal/youtube-mutfak-kurgu.ts   another track (the scenes are kept: only the music and the
 *                                                                    join run again); default cesit-6
 *   SOSYAL_CIKTI=<klasör> …                                     another output folder
 *
 * The owner's rules (18 Ekim): the logo opening, then "Mutfak eğitimi"; only the kitchen's own screen, the kitchen display
 * (Mutfak modu) at normal size, steady; "Garson tableti" and "Misafir telefonu" only briefly, where an order comes from or
 * where "hazır" lands; no pointer: an ordinary tap is a soft ripple only; a red outline and a slight 1.2× move at most once per
 * step, only where something small must be found; a linear story, waits cut silently; a label at the top right "Mutfak
 * ekranı · Adım n / 9"; plain imperative captions; the closing card with molayazilim.com.tr and "Mola eğitim serisi".
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import sharp from 'sharp';
import { ROOT, chapters, dirs, endCardWith, frameFile, guestScene, introCard, marks, shootThumb, staffScene, stepped, taps, trainingThumb, uret, yer, type CaptionsOf, type Scene } from './youtube-sahne';

yer({ rec: join(ROOT, '.local', 'sosyal', 'youtube', 'mutfak', 'kayit'), work: join(ROOT, '.local', 'sosyal', 'youtube', 'mutfak', 'kurgu'),
  out: resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola YouTube', 'E3 Mutfak eğitimi')) });
const STEPS = 9, MUSIC = process.env.MUZIK ?? 'cesit-6';
const label = (who: string) => `${who} <b>· Adım {adim} / ${STEPS}</b>`;
type Opts = { step: number; taps?: string[]; gaps?: [number, number][]; toc?: string };
/** The kitchen display (or, briefly, the waiter's tablet), every caption carrying the step for the top-right label. */
function screen(name: string, clip: string, from: number, to: number, o: Opts & { tablet?: boolean }, captions: CaptionsOf): Scene {
  return staffScene(name, clip, from, to, { frame: o.tablet ? 'tablet' : 'display', tag: label(o.tablet ? 'Garson tableti' : 'Mutfak ekranı'), taps: o.taps, gaps: o.gaps },
    (at, d) => stepped(o.step, captions(at, d)), o.toc);
}
/** The guest's phone, briefly: where a QR order comes from. */
function phone(name: string, clip: string, from: number, to: number, o: Opts, captions: CaptionsOf): Scene {
  return { ...guestScene(name, clip, from, to, o.taps ?? [], (at, d) => stepped(o.step, captions(at, d)), o.toc), tag: label('Misafir telefonu') };
}

function scenes(): Scene[] {
  const list: Scene[] = [];
  list.push({ name: 'a0-giris', duration: 8, card: introCard('Mutfak eğitimi', 'Mutfak ekranında günlük işler, adım adım.'), toc: 'Giriş ve mutfak panosu' });

  // ===== 1. Sign in; the screen and sound icons =====
  const G = marks('m1-giris'), Gt = taps('m1-giris');
  list.push(screen('b1-giris', 'm1-giris', -.4, G.end - .2, { step: 1, taps: ['user', 'pass', 'open', '!tools'], gaps: [[Gt.open.tap! + .15, G.in - .02]] }, at => [
    { from: .2, to: at(Gt.user.on), text: 'Mutfak hesabını işletme sahibi açar.' },
    { from: at(Gt.user.on), to: at(Gt.open.on), text: 'Kullanıcı adınızı ve şifrenizi yazın.' },
    { from: at(Gt.open.on), to: at(G.in), text: '“Çalışma alanını aç”a dokunun.' },
    { from: at(G.in), to: at(Gt.tools.on), text: 'Mutfak panosu tam ekran açılır.' },
    { from: at(Gt.tools.on), to: at(Gt.tools.on + 3.6), text: 'Ekran simgesi açıkken ekran kapanmaz.<br>Tableti şarjda tutun.' },
    { from: at(Gt.tools.on + 3.6), to: 99, text: 'Hoparlör sipariş sesidir. Sarı görünürse<br>hoparlöre dokunun: ses açılır.' },
  ]));

  // ===== 2. The board =====
  const P = taps('m2-pano');
  list.push(screen('b2-pano', 'm2-pano', .2, marks('m2-pano').end - .2, { step: 2, taps: ['!late'] }, at => [
    { from: .2, to: at(P.board.on), text: 'Üstte her aşamada kaç sipariş olduğu yazar.' },
    { from: at(P.board.on), to: at(P.head.on), text: 'Siparişler üç sütunda: Yeni, Hazırlanıyor, Hazır.' },
    { from: at(P.head.on), to: at(P.late.on), text: 'Kartta masa ve sipariş numarası yazar.' },
    { from: at(P.late.on), to: at(P.lines.on), text: 'Bekleme süresi de yazar. 10 dakikayı geçen kart sarı,<br>20 dakikayı geçen kart kırmızı olur.' },
    { from: at(P.lines.on), to: 99, text: 'Seçenekler ürünün altında yazar;<br>garsonun notu sarı kutudadır.' },
  ]));

  // ===== 3. A new order from the waiter's tablet =====
  const T3 = marks('t3-gonder');
  list.push(screen('c1-gonder', 't3-gonder', .2, T3.sent + 1.8, { step: 3, tablet: true, taps: ['send'], toc: 'Sipariş hazırlama' }, () => [
    { from: .2, to: 99, text: 'Garson siparişi tabletten gönderir.' },
  ]));
  const N = marks('m3-yeni'), Nt = taps('m3-yeni');
  list.push(screen('c2-yeni', 'm3-yeni', N.ticket - 1.2, N.end - .2, { step: 3 }, at => [
    { from: .2, to: at(Nt.count.on), text: 'Sipariş “Yeni” sütununa düşer; ekran ses verir.' },
    { from: at(Nt.count.on), to: 99, text: 'Üstteki “Yeni” sayısı da artar.' },
  ]));

  // ===== 4. Ready, "Geri al", start =====
  const R = marks('m4-hazirla'), Rt = taps('m4-hazirla');
  list.push(screen('d1-hazirla', 'm4-hazirla', .2, R.end - .2, { step: 4, taps: ['ready', '!undo', 'start'] }, at => [
    { from: .2, to: at(R.readyDone), text: 'Sipariş hazır olunca “Hazır olarak işaretle”ye dokunun.' },
    { from: at(R.readyDone), to: at(Rt.undo.on), text: 'Kart “Hazır” sütununa geçer.' },
    { from: at(Rt.undo.on), to: at(Rt.start.on), text: 'Yanlış dokunduysanız 5 saniye içinde “Geri al”a dokunun.' },
    { from: at(Rt.start.on), to: 99, text: 'Yeni siparişe başlarken “Hazırlamaya başla”ya dokunun.' },
  ]));

  // ===== 5. What the waiter sees; served =====
  const H = marks('t4-hazir');
  list.push(screen('e1-tablet', 't4-hazir', H.toast - 1, H.toast + 3.4, { step: 5, tablet: true, taps: ['!toast'] }, () => [
    { from: .2, to: 99, text: 'Garsonun tabletinde “hazır” notu çıkar.' },
  ]));
  const S = marks('m5-teslim');
  list.push(screen('e2-teslim', 'm5-teslim', .2, S.gone + 2.2, { step: 5, gaps: [[S.wait0 + .3, S.gone - .6]] }, at => [
    { from: .2, to: at(S.wait0) + .2, text: 'Kart, sipariş masaya gidene kadar “Hazır”da kalır.' },
    { from: at(S.wait0) + .2, to: 99, text: 'Garson “Teslim edildi” deyince kart panodan kalkar.' },
  ]));

  // ===== 6. A QR order: it reaches the kitchen when the guest's change window ends =====
  const Q = marks('q6-telefon'), Qt = taps('q6-telefon');
  list.push(phone('f1-telefon', 'q6-telefon', .2, Q.end - .2, { step: 6, taps: ['send'], toc: 'QR siparişleri' }, at => [
    { from: .2, to: at(Qt.window.on), text: 'Müşteri masadaki QR kodla<br>sipariş verebilir.' },
    { from: at(Qt.window.on), to: 99, text: 'Müşteri siparişini kısa bir süre<br>değiştirebilir.' },
  ]));
  const O = marks('m6-qr'), Ot = taps('m6-qr');
  list.push(screen('f2-qr', 'm6-qr', O.wait0 - .6, O.end - .2, { step: 6, taps: ['!guest', 'start'], gaps: [[O.wait0 + .5, O.ticket - .7]] }, at => [
    { from: .2, to: at(Ot.guest.on), text: 'Süre bitince QR siparişi mutfak ekranına düşer.' },
    { from: at(Ot.guest.on), to: at(Ot.start.on), text: 'QR siparişinin kartında “Misafir” yazar.' },
    { from: at(Ot.start.on), to: 99, text: '“Hazırlamaya başla”ya dokunun.' },
  ]));

  // ===== 7. A changed and a cancelled order =====
  const C = marks('m7-degisti'), Ct = taps('m7-degisti');
  list.push(screen('g1-degisti', 'm7-degisti', .2, C.end - .2, { step: 7, toc: 'Değişiklik ve iptal', gaps: [[C.wait0 + .3, C.changed - .5], [C.wait1 + .3, C.cancelled - .5]] }, at => [
    { from: .2, to: at(C.changed), text: 'Garson bir siparişi değiştirir ya da iptal ederse ekran ses verir.' },
    { from: at(C.changed), to: at(Ct.cardChange.on), text: 'Üstte kırmızı “DEĞİŞTİ” şeridi çıkar: neyin neye değiştiği yazar.' },
    { from: at(Ct.cardChange.on), to: at(C.wait1) + .3, text: 'Kartta da yazar. Siparişi yeni hâliyle hazırlayın.' },
    { from: at(C.cancelled), to: 99, text: '“İPTAL” şeridinde kimin, neden iptal ettiği yazar;<br>kart panodan kalkar.' },
  ]));

  // ===== 8. The guest asks to cancel what the kitchen started =====
  const I = marks('m8-iptal'), It = taps('m8-iptal');
  list.push(screen('h1-iptal', 'm8-iptal', .2, I.done + 2.2, { step: 8, taps: ['approve', '!question', 'yes'], gaps: [[I.wait0 + .3, I.asked - .5]] }, at => [
    { from: .2, to: at(I.asked), text: 'Müşteri, hazırlanan siparişi iptal etmek isteyebilir.' },
    { from: at(I.asked), to: at(It.question.on), text: 'Kartta “Müşteri iptal istiyor” çıkar.<br>“İptali onayla” ya da “Reddet”e dokunun.' },
    { from: at(It.question.on), to: at(It.yes.on), text: 'Hazırlığına başlanan ürün için<br>“Bu üründen stok kullanıldı mı?” diye sorulur.' },
    { from: at(It.yes.on), to: at(I.done), text: 'Kullandıysanız “Evet, hazırlanmıştı (fire)”:<br>malzeme fire olarak düşer. Kullanmadıysanız “Hayır”.' },
    { from: at(I.done), to: 99, text: 'Sipariş iptal edilir; müşteri telefonunda görür.' },
  ]));

  // ===== 9. Stock: count and fire =====
  const K = marks('m9-stok'), Kt = taps('m9-stok');
  list.push(screen('i1-stok', 'm9-stok', .2, K.end - .2, { step: 9, toc: 'Stok: sayım ve fire',
    taps: ['!stok', 'tab', 'count', 'milk', 'beans', 'saveCount', 'waste', 'item', 'amount', 'saveWaste', 'back'] }, at => [
    { from: .2, to: at(K.items), text: 'Stok için üst çubuktaki “Stok”a dokunun.' },
    { from: at(K.items), to: at(Kt.tab.on), text: 'Malzemelerin kalan miktarı görünür;<br>satılan ürünler reçeteden kendiliğinden düşer.' },
    { from: at(Kt.tab.on), to: at(K.countForm), text: '“Sayım ve fire”, sonra “Sayım yap”a dokunun.' },
    { from: at(K.countForm), to: at(Kt.diff.on), text: 'Rafta gerçekte ne varsa yazın.<br>Boş bıraktıklarınız değişmez.' },
    { from: at(Kt.diff.on), to: at(Kt.saveCount.on), text: 'Beklenen miktarla fark yanında görünür.' },
    { from: at(Kt.saveCount.on), to: at(Kt.waste.on), text: '“Sayımı kaydet”: stok sayılan miktardan devam eder.' },
    { from: at(Kt.waste.on), to: at(Kt.saveWaste.on), text: 'Bozulan ya da dökülen malzeme için “Fire kaydet”:<br>malzemeyi, miktarı ve nedeni seçin.' },
    { from: at(Kt.saveWaste.on), to: at(Kt.back.on), text: '“Fireyi kaydet”. Kayıtlar “Son hareketler”de görünür.' },
    { from: at(Kt.back.on), to: 99, text: '“Mutfak panosu” ile panoya dönün.' },
  ]));
  list.push({ name: 'j0-son', duration: 7.5, card: endCardWith('Mola eğitim serisi') });
  return list;
}

// ---------- Description and thumbnail ----------
function description(list: Scene[]) {
  const { lines } = chapters(list);
  const title = 'Mutfak eğitimi: mutfak ekranı, sipariş, iptal ve stok sayımı | Mola';
  if (title.length > 70) throw new Error(`Başlık ${title.length} karakter.`);
  const text = `BAŞLIK (${title.length} karakter)
${title}

AÇIKLAMA
Mola adisyon ve QR menü sisteminde mutfak çalışanının mutfak ekranındaki günlük işleri adım adım gösteriliyor. Görüntüler uygulamanın kendisinden, örnek bir işletmeyle kaydedildi. Mutfak hesabını işletme sahibi açar; mutfak ekranı yalnız mutfak hesabıyla açılır ve fiyat göstermez.

Adımlar:
1. Giriş: kullanıcı adı ve şifre → Çalışma alanını aç; mutfak panosu tam ekran açılır. Ekran simgesi açıkken ekran kapanmaz; hoparlör sipariş sesidir (sarı görünürse dokunun, ses açılır).
2. Mutfak panosu: Yeni, Hazırlanıyor, Hazır sütunları; kartta masa, sipariş numarası, bekleme süresi, seçenekler ve not. 10 dakikayı geçen kart sarı, 20 dakikayı geçen kart kırmızı olur.
3. Yeni sipariş: garson tabletten gönderir; sipariş Yeni sütununa düşer, ekran ses verir.
4. Hazırla ve hazır: Hazırlamaya başla → Hazır olarak işaretle; yanlış dokunuşta 5 saniye içinde Geri al.
5. Servise hazır: garsonun tabletinde “hazır” notu çıkar; garson Teslim edildi deyince kart panodan kalkar.
6. QR siparişleri: müşterinin değiştirme süresi bitince sipariş mutfak ekranına düşer; kartta “Misafir” yazar.
7. Değişiklik ve iptal: garson bir siparişi değiştirirse “DEĞİŞTİ”, iptal ederse “İPTAL” şeridi çıkar.
8. Müşteri iptal talebi: İptali onayla ya da Reddet; hazırlığına başlanan üründe “Bu üründen stok kullanıldı mı?” → Evet, hazırlanmıştı (fire) ya da Hayır, stok kullanılmadı.
9. Stok: Stok → Malzemeler; Sayım ve fire → Sayım yap (rafta ne varsa) ve Fire kaydet (malzeme, miktar, neden). Mutfak stok alışı, fiyat ve reçete değiştiremez.

Mutfak, siparişleri ekran yerine yazıcıdan fişle de alabilir: işletme sahibi Ayarlar → Sipariş ve mutfak → Mutfak → “Mutfak nasıl çalışıyor?”tan “Fiş”i seçerse mutfak ekranı kullanılmaz, her sipariş mutfak yazıcısından fiş olarak çıkar.

Bölümler
${lines.join('\n')}

Web: https://molayazilim.com.tr
E-posta: destek@molayazilim.com.tr

ETİKETLER
mutfak eğitimi, mutfak ekranı, mutfak tableti, adisyon programı, kafe adisyon, restoran adisyon, sipariş hazırlama, QR sipariş, sipariş iptali, stok sayımı, fire kaydı, Mola, Mola adisyon, Mola eğitim
`;
  writeFileSync(join(dirs.out, 'aciklama.txt'), text.replace(/\n/g, '\r\n'));
  console.log(lines.join('\n'));
}
async function thumbnail(browser: Browser) {
  // The board: three columns, Masa 04's late card with its note.
  const shot = join(dirs.work, 'kapak-pano.png');
  await sharp(frameFile('m2-pano', marks('m2-pano').end - .5)).resize(1280).png().toFile(shot);
  await shootThumb(browser, trainingThumb({ title: 'Mutfak<br>eğitimi', line: 'Mutfak ekranı, sipariş,<br>iptal ve stok sayımı.', shot, device: 'display' }));
}

await uret({ mp4: 'Mutfak eğitimi.mp4', music: MUSIC, description, thumbnail, scenes,
  stillsAt: process.env.KARE_SIK ? (s => Array.from({ length: Math.ceil(s.duration / 2) }, (_, i) => Math.min(s.duration - .05, i * 2 + .6))) : undefined });
