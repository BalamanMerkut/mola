/*
 * YouTube E4 "Müdür eğitimi" (training series: the owner tells a new Müdür "watch this"): the 1920×1080 video, kapak.jpg and
 * aciklama.txt from the recordings of scripts/sosyal/youtube-mudur-kayit.ts, on the shared stage of scripts/sosyal/youtube-sahne.ts
 * (as E1–E3). No voice-over: captions and the music of scripts/sosyal/muzik.py (soft breaks at the chapters), -20 LUFS.
 *
 *   npx tsx scripts/sosyal/youtube-mudur-kurgu.ts              everything (scenes → video → music → kapak.jpg, aciklama.txt)
 *   npx tsx scripts/sosyal/youtube-mudur-kurgu.ts c1 e1        only these scenes again (then the video is joined again)
 *   npx tsx scripts/sosyal/youtube-mudur-kurgu.ts --kare       a few stills per scene (layout check), no video
 *   npx tsx scripts/sosyal/youtube-mudur-kurgu.ts --kapak      only the thumbnail and the description
 *   MUZIK=cesit-8 npx tsx scripts/sosyal/youtube-mudur-kurgu.ts   another track (the scenes are kept: only the music and the
 *                                                                  join run again); default cesit-7
 *   SOSYAL_CIKTI=<klasör> …                                     another output folder
 *
 * Only what the Müdür role has (packages/domain/roles.ts); the waiter's and the cashier's work is left to E1 and E2 (one caption
 * says so). The owner's rules (18 Ekim): the logo opening, then "Müdür eğitimi"; the café computer's Mola window at normal size,
 * steady; "Misafir telefonu" and "Kasa ekranı" only briefly, where a change lands; no pointer: an ordinary click is a soft
 * ripple only; a red outline and a slight 1.2× move at most once per step, only where something small must be found; a linear
 * story, waits cut silently; a label at the top right "Müdür · Adım n / 10"; plain imperative captions; the closing card with
 * molayazilim.com.tr and "Mola eğitim serisi".
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import sharp from 'sharp';
import { ROOT, chapters, dirs, endCardWith, frameFile, guestScene, introCard, marks, shootThumb, staffScene, stepped, taps, trainingThumb, uret, yer, type CaptionsOf, type Scene } from './youtube-sahne';

yer({ rec: join(ROOT, '.local', 'sosyal', 'youtube', 'mudur', 'kayit'), work: join(ROOT, '.local', 'sosyal', 'youtube', 'mudur', 'kurgu'),
  out: resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola YouTube', 'E4 Müdür eğitimi')) });
const STEPS = 10, MUSIC = process.env.MUZIK ?? 'cesit-7';
const label = (who: string) => `${who} <b>· Adım {adim} / ${STEPS}</b>`;
type Opts = { step: number; taps?: string[]; gaps?: [number, number][]; toc?: string };
/** The Müdür's Mola window (or, briefly, the cashier's), every caption carrying the step for the top-right label. */
function screen(name: string, clip: string, from: number, to: number, o: Opts & { who?: string }, captions: CaptionsOf): Scene {
  return staffScene(name, clip, from, to, { frame: 'win', title: 'Mola · İşletme yönetimi', tag: label(o.who ?? 'Müdür'), taps: o.taps, gaps: o.gaps },
    (at, d) => stepped(o.step, captions(at, d)), o.toc);
}
/** The guest's phone, briefly: where a change to the menu shows. */
function phone(name: string, clip: string, from: number, to: number, o: Opts, captions: CaptionsOf): Scene {
  return { ...guestScene(name, clip, from, to, o.taps ?? [], (at, d) => stepped(o.step, captions(at, d)), o.toc), tag: label('Misafir telefonu') };
}

function scenes(): Scene[] {
  const list: Scene[] = [];
  list.push({ name: 'a0-giris', duration: 8, card: introCard('Müdür eğitimi', 'Müdür hesabıyla günlük yönetim, adım adım.'), toc: 'Giriş ve günün özeti' });

  // ===== 1. Sign in; the Müdür's places =====
  const G = marks('r1-giris'), Gt = taps('r1-giris');
  list.push(screen('b1-giris', 'r1-giris', -.4, G.end - .2, { step: 1, taps: ['user', 'pass', 'open'], gaps: [[Gt.open.tap! + .15, G.in - .02]] }, at => [
    { from: .2, to: at(Gt.user.on), text: 'Müdür hesabını işletme sahibi açar.' },
    { from: at(Gt.user.on), to: at(Gt.open.on), text: 'Kullanıcı adınızı ve şifrenizi yazın.' },
    { from: at(Gt.open.on), to: at(G.in), text: '“Çalışma alanını aç”a tıklayın.' },
    { from: at(G.in), to: at(Gt.daily.on), text: 'Masalar ekranı açılır.' },
    { from: at(Gt.daily.on), to: at(Gt.account.on), text: 'Solda Müdür’ün bölümleri: günlük işler ve işletme.' },
    { from: at(Gt.account.on), to: 99, text: 'Ayarlar ve çalışan hesapları işletme sahibindedir.' },
  ]));

  // ===== 2. The day at a glance =====
  const O = taps('r2-ozet');
  list.push(screen('b2-ozet', 'r2-ozet', .2, marks('r2-ozet').end - .2, { step: 2, taps: ['!line', 'open'] }, at => [
    { from: .2, to: at(O.chip.on), text: 'Üstte günün özeti: açık masalar, açık hesap,<br>mutfaktaki ve servise hazır siparişler.' },
    { from: at(O.chip.on), to: at(O.open.on), text: 'Kasanın durumu yanında yazar.' },
    { from: at(O.open.on), to: at(O.tables.on), text: '“Açık”a tıklayın: yalnız dolu masalar görünür.' },
    { from: at(O.tables.on), to: 99, text: 'Garson ve kasa işlemleri için ilgili eğitim videolarına bakın.' },
  ]));

  // ===== 3. Cancelling an item with a reason =====
  const I = marks('r3-iptal'), It = taps('r3-iptal');
  list.push(screen('c1-iptal', 'r3-iptal', .2, I.end - .2, { step: 3, toc: 'Sipariş iptali', taps: ['table', '!cancel', 'item', 'reason', 'save', 'again'] }, at => [
    { from: .2, to: at(It.order.on), text: 'Yanlış girilen bir sipariş için masaya tıklayın.' },
    { from: at(It.order.on), to: at(It.cancel.on), text: 'Masanın siparişleri görünür.' },
    { from: at(It.cancel.on), to: at(I.modal), text: 'Siparişin altındaki “İptal et”e tıklayın.' },
    { from: at(I.modal), to: at(It.reason.on), text: 'İptal edilecek ürünü ve adedini seçin.' },
    { from: at(It.reason.on), to: at(It.save.on), text: 'İptalin nedenini seçin ya da yazın.' },
    { from: at(It.save.on), to: at(I.done) + .2, text: '“Seçilenleri iptal et”e tıklayın.' },
    { from: at(I.done) + .2, to: at(It.again.on), text: 'Ürün hesaptan düşer.' },
    { from: at(It.again.on), to: 99, text: 'Siparişte iptal edilen ürün ve nedeni yazar.' },
  ]));

  // ===== 4. Sold out, and back =====
  const T = marks('r4-tukendi'), Tt = taps('r4-tukendi');
  list.push(screen('d1-tukendi', 'r4-tukendi', .2, T.end - .2, { step: 4, toc: 'Menü: tükendi ve fiyat', taps: ['nav', 'search', '!soldout'] }, at => [
    { from: .2, to: at(T.menu), text: 'Biten bir ürün için “Menü yönetimi”ne tıklayın.' },
    { from: at(T.menu), to: at(Tt.soldout.on), text: 'Ürünü adıyla arayın.' },
    { from: at(Tt.soldout.on), to: at(T.done), text: 'Ürünün yanındaki “Tükendi”yi işaretleyin.' },
    { from: at(T.done), to: 99, text: 'Değişiklik hemen kaydedilir.' },
  ]));
  list.push(phone('d2-telefon', 'q4-menu', .2, marks('q4-menu').end - .2, { step: 4 }, () => [
    { from: .2, to: 99, text: 'Müşterinin menüsünde ürün<br>“Tükendi” görünür; sipariş<br>verilemez.' },
  ]));
  const B = marks('r4-geri');
  list.push(screen('d3-geri', 'r4-geri', .2, B.end - .2, { step: 4, taps: ['back'] }, () => [
    { from: .2, to: 99, text: 'Ürün yeniden gelince işareti kaldırın.' },
  ]));

  // ===== 5. A new price =====
  const F = marks('r5-fiyat'), Ft = taps('r5-fiyat');
  list.push(screen('d4-fiyat', 'r5-fiyat', .2, F.end - .2, { step: 5, taps: ['search', 'edit', 'price', 'save'] }, at => [
    { from: .2, to: at(Ft.edit.on), text: 'Fiyat değiştirmek için ürünü arayın.' },
    { from: at(Ft.edit.on), to: at(F.editor), text: '“Düzenle”ye tıklayın.' },
    { from: at(F.editor), to: at(Ft.save.on), text: 'Yeni fiyatı “Fiyat (TL)” alanına yazın.' },
    { from: at(Ft.save.on), to: at(F.done) + .2, text: '“Kaydet ve yayınla”ya tıklayın.' },
    { from: at(F.done) + .2, to: 99, text: 'Yeni fiyat menüde hemen geçerli olur.' },
  ]));

  // ===== 6. The cashier's refund request =====
  const R = marks('r6-iade'), Rt = taps('r6-iade');
  list.push(screen('e1-iade', 'r6-iade', .2, R.end - .2, { step: 6, toc: 'Kasiyerin iade isteği', taps: ['nav', 'tab', '!request', 'do', 'save', 'yes'] }, at => [
    { from: .2, to: at(Rt.nav.tap!), text: 'Kasiyer, sınırını aşan bir iade için istek gönderir.' },
    { from: at(Rt.nav.tap!), to: at(R.list), text: '“Kasa ve giderler”, sonra “İadeler”e tıklayın.' },
    { from: at(R.list), to: at(Rt.do.on), text: '“Bekleyen iade istekleri”nde masa, tutar ve neden yazar.' },
    { from: at(Rt.do.on), to: at(R.form), text: '“İadeyi yap”a tıklayın.' },
    { from: at(R.form), to: at(Rt.save.on), text: 'Kasiyerin seçimleri gelir; gerekirse değiştirin.' },
    { from: at(Rt.save.on), to: at(R.done) + .2, text: '“İadeyi kaydet”, sonra “Evet, iadeyi kaydet”e tıklayın.' },
    { from: at(R.done) + .2, to: 99, text: 'İade kaydedilir. Uygun değilse istek “Reddet” ile kapanır.' },
  ]));
  list.push(screen('e2-kasa', 'k6-kasa', .2, marks('k6-kasa').end - .2, { step: 6, who: 'Kasa ekranı', taps: ['!note'] }, () => [
    { from: .2, to: 99, text: 'Kasiyerin ekranında not çıkar; nakit iadeyi kasiyer verir.' },
  ]));

  // ===== 7. Stopping QR orders =====
  const Q = marks('r7-qr'), Qt = taps('r7-qr');
  list.push(screen('f1-qr', 'r7-qr', .2, Q.end - .2, { step: 7, toc: 'QR siparişleri ve rezervasyon', taps: ['!stop', 'confirm', 'reopen'] }, at => [
    { from: .2, to: at(Qt.stop.on), text: 'Mutfak çok yoğunsa QR siparişlerini durdurabilirsiniz.' },
    { from: at(Qt.stop.on), to: at(Q.ask), text: 'Soldaki “Durdur”a tıklayın.' },
    { from: at(Q.ask), to: at(Q.closed), text: 'Menü görünmeye devam eder; siparişleri garsonlar alır.<br>“Durdur”a tıklayın.' },
    { from: at(Q.closed), to: at(Qt.bar.on), text: 'Müşteriler telefondan sipariş veremez.' },
    { from: at(Qt.bar.on), to: at(Qt.reopen.on), text: 'Masalar’ın üstünde de yazar.' },
    { from: at(Qt.reopen.on), to: 99, text: 'Yeniden açmak için “Siparişleri aç”a tıklayın.' },
  ]));

  // ===== 8. A reservation =====
  const V = marks('r8-rezerv'), Vt = taps('r8-rezerv');
  list.push(screen('f2-rezerv', 'r8-rezerv', .2, V.end - .2, { step: 8, taps: ['nav', 'time', 'table', 'name', 'people', 'note', 'save'] }, at => [
    { from: .2, to: at(V.plan), text: 'Rezervasyon için “Ajanda ve rezervasyon”a tıklayın.' },
    { from: at(V.plan), to: at(Vt.table.on), text: 'Saati yazın: masa planı o saate göre görünür.' },
    { from: at(Vt.table.on), to: at(V.form), text: 'Boş bir masaya tıklayın.' },
    { from: at(V.form), to: at(Vt.save.on), text: 'Misafirin adını ve kişi sayısını yazın; isterseniz not ekleyin.' },
    { from: at(Vt.save.on), to: at(V.done) + .2, text: '“Kaydet”e tıklayın.' },
    { from: at(V.done) + .2, to: at(Vt.list.on), text: 'Masa o saat için “Rezerve” görünür.' },
    { from: at(Vt.list.on), to: 99, text: 'Günün rezervasyonları altta listelenir.' },
  ]));

  // ===== 9. Reports and closings =====
  const P = marks('r9-rapor'), Pt = taps('r9-rapor');
  list.push(screen('g1-rapor', 'r9-rapor', .2, P.end - .2, { step: 9, toc: 'Raporlar, kapanışlar ve vardiyalar', taps: ['nav', 'closings', 'week'] }, at => [
    { from: .2, to: at(Pt.sentence.on), text: 'Günün sonuçları için “Satış ve Raporlar”a tıklayın.' },
    { from: at(Pt.sentence.on), to: at(Pt.grid.on), text: 'Bugünkü sipariş ve satış tek cümlede yazar.' },
    { from: at(Pt.grid.on), to: at(Pt.kasa.on), text: 'Altında satış, giderler, elde kalan ve sipariş sayısı.' },
    { from: at(Pt.kasa.on), to: at(P.list), text: 'Gün sonu sayımları için “Kasa kapanışları”na tıklayın;<br>dönemi seçin.' },
    { from: at(P.list), to: 99, text: 'Kimin, ne zaman, ne saydığı görünür.<br>Beklenen nakit ve fark yalnız işletme sahibinde görünür.' },
  ]));

  // ===== 10. Who worked today =====
  const S = marks('r10-personel'), St = taps('r10-personel');
  list.push(screen('g2-personel', 'r10-personel', .2, S.end - .2, { step: 10, taps: ['nav'] }, at => [
    { from: .2, to: at(St.list.on), text: '“Personel”de bugün kimin çalıştığı görünür.' },
    { from: at(St.list.on), to: 99, text: 'Her çalışanın süresi, sipariş sayısı ve satışı yazar.' },
  ]));
  list.push({ name: 'j0-son', duration: 7.5, card: endCardWith('Mola eğitim serisi') });
  return list;
}

// ---------- Description and thumbnail ----------
function description(list: Scene[]) {
  const { lines } = chapters(list);
  const title = 'Müdür eğitimi: iptal, menü, iade istekleri ve raporlar | Mola';
  if (title.length > 70) throw new Error(`Başlık ${title.length} karakter.`);
  const text = `BAŞLIK (${title.length} karakter)
${title}

AÇIKLAMA
Mola adisyon ve QR menü sisteminde Müdür hesabıyla yapılan günlük yönetim işleri adım adım gösteriliyor. Görüntüler uygulamanın kendisinden, örnek bir işletmeyle kaydedildi. Müdür hesabını işletme sahibi Personel → Çalışanlar'dan açar. Garson ve kasa işlemleri (sipariş, ödeme, kasa açılışı, gün sonu) Garson eğitimi ve Kasiyer eğitimi videolarında anlatılıyor; Müdür bunları da yapabilir.

Adımlar:
1. Giriş: kullanıcı adı ve şifre → Çalışma alanını aç. Ayarlar ve çalışan hesapları işletme sahibindedir.
2. Günün özeti: Masalar'ın üstünde açık masa, açık hesap, mutfaktaki ve servise hazır siparişler; yanında kasanın durumu. “Açık” yalnız dolu masaları gösterir.
3. Sipariş iptali: masa → İptal et → ürün ve adet → iptal nedeni → Seçilenleri iptal et.
4. Tükendi: Menü yönetimi → ürünü arayın → Tükendi. Müşteri menüsünde ürün “Tükendi” görünür, sipariş verilemez. Ürün gelince işareti kaldırın.
5. Fiyat: Menü yönetimi → Düzenle → Fiyat (TL) → Kaydet ve yayınla.
6. Kasiyerin iade isteği: Kasa ve giderler → İadeler → Bekleyen iade istekleri → İadeyi yap → İadeyi kaydet (ya da Reddet). Müdür'ün iade tutar sınırı yoktur. Kasiyerin ekranında not çıkar; nakit iadeyi kasiyer verir.
7. QR siparişlerini durdurma: soldaki kartta Durdur → Durdur. Menü görünmeye devam eder, siparişleri garsonlar alır. Yeniden açmak için Siparişleri aç.
8. Rezervasyon: Ajanda ve rezervasyon → saat → boş masa → ad, kişi sayısı, not → Kaydet.
9. Raporlar ve kapanışlar: Satış ve Raporlar (Bugün) → Kasa kapanışları. Kimin, ne zaman, ne saydığı görünür; beklenen nakit ve fark yalnız işletme sahibinde görünür.
10. Personel: Vardiyalar'da bugün kimin ne kadar çalıştığı, sipariş sayısı ve satışı.

Müdür ayrıca Stok'un tamamını (malzeme, reçete, alış, sayım ve fire) ve Kampanyaları yönetir; bunlar ayrı videolarda anlatılır. Ayarlar, çalışan hesapları, sahibin kasa hareketleri, Destek ve lisans yalnız işletme sahibindedir.

Bölümler
${lines.join('\n')}

Web: https://molayazilim.com.tr
E-posta: destek@molayazilim.com.tr

ETİKETLER
müdür eğitimi, kafe müdürü, restoran müdürü, adisyon programı, kafe adisyon, restoran adisyon, sipariş iptali, tükendi, menü fiyatı, iade isteği, QR sipariş, rezervasyon, satış raporu, Mola, Mola eğitim
`;
  writeFileSync(join(dirs.out, 'aciklama.txt'), text.replace(/\n/g, '\r\n'));
  console.log(lines.join('\n'));
}
async function thumbnail(browser: Browser) {
  // Satış ve Raporlar, Bugün: the sentence and the cards.
  const shot = join(dirs.work, 'kapak-rapor.png');
  await sharp(frameFile('r9-rapor', taps('r9-rapor').grid.on + .8)).resize(1280).png().toFile(shot);
  await shootThumb(browser, trainingThumb({ title: 'Müdür<br>eğitimi', line: 'İptal, menü, iade<br>istekleri ve raporlar.', shot, device: 'window' }));
}

await uret({ mp4: 'Müdür eğitimi.mp4', music: MUSIC, description, thumbnail, scenes,
  stillsAt: process.env.KARE_SIK ? (s => Array.from({ length: Math.ceil(s.duration / 2) }, (_, i) => Math.min(s.duration - .05, i * 2 + .6))) : undefined });
