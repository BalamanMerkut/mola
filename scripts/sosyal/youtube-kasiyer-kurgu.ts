/*
 * YouTube E2 "Kasiyer eğitimi" (training series: the owner tells a new cashier "watch this"): the 1920×1080 video, kapak.jpg and
 * aciklama.txt from the recordings of scripts/sosyal/youtube-kasiyer-kayit.ts, on the shared stage of scripts/sosyal/youtube-sahne.ts
 * (as E1 "Garson eğitimi"). No voice-over: captions and the music of scripts/sosyal/muzik.py (soft breaks at the chapters), -20 LUFS.
 *
 *   npx tsx scripts/sosyal/youtube-kasiyer-kurgu.ts              everything (scenes → video → music → kapak.jpg, aciklama.txt)
 *   npx tsx scripts/sosyal/youtube-kasiyer-kurgu.ts c1 e1        only these scenes again (then the video is joined again)
 *   npx tsx scripts/sosyal/youtube-kasiyer-kurgu.ts --kare       a few stills per scene (layout check), no video
 *   npx tsx scripts/sosyal/youtube-kasiyer-kurgu.ts --kapak      only the thumbnail and the description
 *   MUZIK=cesit-6 npx tsx scripts/sosyal/youtube-kasiyer-kurgu.ts   another track (the scenes are kept: only the music and the
 *                                                                    join run again); default cesit-5
 *   SOSYAL_CIKTI=<klasör> …                                     another output folder
 *
 * The owner's rules (18 Ekim): the logo opening, then "Kasiyer eğitimi"; only the cashier's own screen, the counter's Mola window at
 * normal size, steady; no pointer: an ordinary click is a soft ripple only; a red outline and a slight 1.2× move at most once per
 * step, only where something small must be found; a linear story, waits cut silently; a label at the top right "Kasa ekranı ·
 * Adım n / 9"; plain imperative captions; the closing card with molayazilim.com.tr and "Mola eğitim serisi".
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import sharp from 'sharp';
import { ROOT, chapters, dirs, endCardWith, frameFile, introCard, marks, shootThumb, staffScene, stepped, taps, trainingThumb, uret, yer, type CaptionsOf, type Scene } from './youtube-sahne';

yer({ rec: join(ROOT, '.local', 'sosyal', 'youtube', 'kasiyer', 'kayit'), work: join(ROOT, '.local', 'sosyal', 'youtube', 'kasiyer', 'kurgu'),
  out: resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola YouTube', 'E2 Kasiyer eğitimi')) });
const STEPS = 9, MUSIC = process.env.MUZIK ?? 'cesit-5';
/** The counter's Mola window, every caption carrying the step for the top-right label. */
function kasa(name: string, clip: string, from: number, to: number, o: { step: number; taps?: string[]; gaps?: [number, number][]; toc?: string }, captions: CaptionsOf): Scene {
  return staffScene(name, clip, from, to, { frame: 'win', title: 'Mola · İşletme yönetimi', tag: `Kasa ekranı <b>· Adım {adim} / ${STEPS}</b>`, taps: o.taps, gaps: o.gaps },
    (at, d) => stepped(o.step, captions(at, d)), o.toc);
}

function scenes(): Scene[] {
  const list: Scene[] = [];
  list.push({ name: 'a0-giris', duration: 8, card: introCard('Kasiyer eğitimi', 'Kasa ekranında günlük işler, adım adım.'), toc: 'Giriş ve kasa açılışı' });

  // ===== 1. Sign in =====
  const G = marks('k1-giris'), Gt = taps('k1-giris');
  list.push(kasa('b1-giris', 'k1-giris', -.4, G.end - .2, { step: 1, taps: ['user', 'pass', 'open'], gaps: [[Gt.open.tap! + .15, G.in - .02]] }, at => [
    { from: .2, to: at(Gt.user.on), text: 'Hesabınızı işletme sahibi açar.' },
    { from: at(Gt.user.on), to: at(Gt.open.on), text: 'Kullanıcı adınızı ve şifrenizi yazın.' },
    { from: at(Gt.open.on), to: at(G.in), text: '“Çalışma alanını aç”a tıklayın.' },
    { from: at(G.in), to: 99, text: 'Masalar ekranı açılır.' },
  ]));

  // ===== 2. The opening =====
  const A = marks('k2-acilis'), At = taps('k2-acilis');
  list.push(kasa('b2-acilis', 'k2-acilis', .2, A.end - .2, { step: 2, taps: ['confirm'], gaps: [[At.card.on + 3, At.card.off! - .05]] }, at => [
    { from: .2, to: at(At.card.on + 2.2), text: 'Güne başlarken önce kasayı açın.' },
    { from: at(At.card.on + 2.2), to: at(At.other.on), text: 'Kasadaki nakdi sayın.<br>Dünden devreden tutarla aynıysa onaylayın.' },
    { from: at(At.other.on), to: at(At.confirm.on), text: 'Tutar farklıysa “Farklı tutar bildir”e tıklayın<br>ve farkın nedenini yazın.' },
    { from: at(At.confirm.on), to: at(A.open) + .3, text: '“Açılışı onayla”ya tıklayın.' },
    { from: at(A.open) + .3, to: 99, text: 'Kasa açıldı. Kasanın durumu sağ üstte görünür.' },
  ]));

  // ===== 3. Cash =====
  const N = marks('k3-nakit'), Nt = taps('k3-nakit');
  list.push(kasa('c1-nakit', 'k3-nakit', .2, Nt.cleaning.on + 1.8, { step: 3, toc: 'Nakit ve kart ödeme', taps: ['table', 'pay', 'note', 'save'], gaps: [[Nt.due.on + 2.1, Nt.due.off! - .05]] }, at => [
    { from: .2, to: at(Nt.bill.on), text: 'Ödeme almak için masaya tıklayın.' },
    { from: at(Nt.bill.on), to: at(Nt.pay.on), text: 'Masanın siparişleri ve kalan hesabı görünür.' },
    { from: at(Nt.pay.on), to: at(Nt.method.on), text: '“Ödeme al”a tıklayın.' },
    { from: at(Nt.method.on), to: at(Nt.note.on), text: 'Ödeme şeklini seçin: Nakit.' },
    { from: at(Nt.note.on), to: at(Nt.change.on), text: 'Müşterinin verdiği parayı seçin ya da yazın.' },
    { from: at(Nt.change.on), to: at(Nt.save.on), text: 'Para üstü kendiliğinden hesaplanır.' },
    { from: at(Nt.save.on), to: at(N.paid) + .2, text: '“Ödemeyi kaydet”e tıklayın.' },
    { from: at(N.paid) + .2, to: at(Nt.cleaning.on), text: 'Verilecek para üstü ekranda bir süre kalır.' },
    { from: at(Nt.cleaning.on), to: 99, text: 'Hesap kapanır; masa temizlik bekler.' },
  ]));

  // ===== 4. The bill request, card =====
  const K = marks('k4-kart'), Kt = taps('k4-kart');
  list.push(kasa('c2-kart', 'k4-kart', .2, K.paid + 2, { step: 4, taps: ['!call', 'open', 'pay', 'save'], gaps: [[K.wait0 + .3, K.chip - .5]] }, at => [
    { from: .2, to: at(Kt.call.on) + .2, text: 'Müşteri hesabı isteyince ekranın üstünde bir istek çıkar.' },
    { from: at(Kt.call.on) + .2, to: at(Kt.open.on), text: 'Ödeme şekli yanında yazar: “Hesap · Kart”.' },
    { from: at(Kt.open.on), to: at(Kt.pay.on), text: 'İsteğe tıklayın: masa açılır.' },
    { from: at(Kt.pay.on), to: at(Kt.pos.on), text: '“Ödeme al”: pencere Kart seçili açılır.' },
    { from: at(Kt.pos.on), to: at(K.paid) + .2, text: 'Tutarı POS cihazından çekin,<br>sonra “Ödemeyi kaydet”e tıklayın.' },
    { from: at(K.paid) + .2, to: 99, text: 'Hesap kapanır; istek de kendiliğinden kalkar.' },
  ]));

  // ===== 5. Splitting the bill =====
  const B = marks('k5-bolme'), Bt = taps('k5-bolme');
  list.push(kasa('d1-bolme', 'k5-bolme', .2, B.paid3 + 1.9, { step: 5, toc: 'Hesap bölme ve kısmi ödeme',
    taps: ['table', 'pay', '!items', 'i0', 'i1', 'card1', 'save1', 'part', 'amount', 'cash2', 'save2', 'card3', 'save3'] }, at => [
    { from: .2, to: at(Bt.items.on), text: 'Hesabı bölmek için masaya, sonra “Ödeme al”a tıklayın.' },
    { from: at(Bt.items.on), to: at(Bt.i0.on), text: 'Ürüne göre bölmek için “Ürün seç”e tıklayın.' },
    { from: at(Bt.i0.on), to: at(Bt.sum.on), text: 'Ödeyen kişinin ürünlerini “+” ile seçin.' },
    { from: at(Bt.sum.on), to: at(Bt.card1.on), text: 'Seçilen ürünlerin toplamı altta yazar.' },
    { from: at(Bt.card1.on), to: at(B.paid1) + .2, text: 'Ödeme şeklini seçip kaydedin.' },
    { from: at(B.paid1) + .2, to: at(Bt.part.on), text: 'Kalan hesap güncellenir.' },
    { from: at(Bt.part.on), to: at(Bt.cash2.on), text: 'Tutara göre bölmek için “Bir kısmı”: tutarı yazın.' },
    { from: at(Bt.cash2.on), to: at(B.paid2) + .2, text: 'Ödeme şeklini seçip kaydedin.' },
    { from: at(B.paid2) + .2, to: at(B.paid3) + .2, text: 'Kalanı aynı pencereden alın.' },
    { from: at(B.paid3) + .2, to: 99, text: 'Hesabın tamamı ödenince masa kapanır.' },
  ]));

  // ===== 6. A sale without a table =====
  const M = marks('k6-masasiz'), Mt = taps('k6-masasiz');
  const mTaps = ['new', 'choice', 'name', 'p0', 'p1', ...(Mt.p1add ? ['p1add'] : []), 'send', 'card', 'save', 'nav', 'served'];
  list.push(kasa('e1-masasiz', 'k6-masasiz', .2, M.end - .2, { step: 6, toc: 'Masasız satış', taps: mTaps, gaps: [[Mt.strip.on + 2, Mt.strip.off! - .1], [M.wait0 + .3, M.ready - .5]] }, at => [
    { from: .2, to: at(Mt.choice.on), text: 'Tezgâhtan satış için “Sipariş al”a tıklayın.' },
    { from: at(Mt.choice.on), to: at(Mt.name.on), text: '“Masasız sipariş”i seçin.' },
    { from: at(Mt.name.on), to: at(Mt.p0.on), text: 'İsterseniz müşterinin adını yazın.' },
    { from: at(Mt.p0.on), to: at(Mt.send.on), text: Mt.p1add ? 'Ürünleri ekleyin. Seçenekli üründe<br>seçimi yapıp “Sepete ekle”ye tıklayın.' : 'Ürünleri “+” ile ekleyin.' },
    { from: at(Mt.send.on), to: at(M.payment), text: '“Gönder”: sipariş mutfağa gider.' },
    { from: at(M.payment), to: at(Mt.card.on), text: 'Ödeme penceresi hemen açılır.<br>Müşteri sonra ödeyecekse “Sonra öde”.' },
    { from: at(Mt.card.on), to: at(Mt.nav.on), text: 'Ödemeyi alıp kaydedin.' },
    { from: at(Mt.nav.on), to: at(M.strip) - .1, text: 'Masalar’a dönün.' },
    { from: at(M.strip) - .1, to: at(Mt.readyCard.on), text: 'Masasız siparişler Masalar’ın üstünde görünür.' },
    { from: at(Mt.readyCard.on), to: at(M.done) + .2, text: 'Müşteri siparişini alınca “Teslim edildi”ye tıklayın.' },
    { from: at(M.done) + .2, to: 99, text: 'Ödenmiş ve teslim edilmiş sipariş listeden kalkar.' },
  ]));

  // ===== 7. A refund =====
  const R = marks('k7-iade'), Rt = taps('k7-iade');
  list.push(kasa('f1-iade', 'k7-iade', .2, R.done + 2.1, { step: 7, toc: 'İade ve gider', taps: ['!chip', 'action', 'row', 'item', 'reason', 'note', 'save', 'yes'] }, at => [
    { from: .2, to: at(Rt.action.on), text: 'İade için sağ üstteki kasa düğmesine tıklayın.' },
    { from: at(Rt.action.on), to: at(R.window), text: 'Açılan listeden “İade”yi seçin.' },
    { from: at(R.window), to: at(Rt.row.on), text: 'Kasiyerin iade sınırı en üstte yazar.<br>Fazlası için işletme sahibine istek gider.' },
    { from: at(Rt.row.on), to: at(Rt.item.on), text: 'Bugünkü ödemelerden doğru olanı seçin.' },
    { from: at(Rt.item.on), to: at(Rt.reason.on), text: 'İade edilecek ürünü “+” ile seçin.' },
    { from: at(Rt.reason.on), to: at(Rt.method.on), text: 'İadenin nedenini seçin; gerekirse kısa bir açıklama yazın.' },
    { from: at(Rt.method.on), to: at(Rt.save.on), text: 'İade, ödemenin alındığı şekilde yapılır.<br>Nakit iadede parayı kasadan verin.' },
    { from: at(Rt.save.on), to: at(R.done) + .2, text: '“İadeyi kaydet”e tıklayın ve onaylayın.' },
    { from: at(R.done) + .2, to: 99, text: 'İade kaydedilir; işletme sahibi raporda görür.' },
  ]));

  // ===== 8. An expense =====
  const E = marks('k8-gider'), Et = taps('k8-gider');
  list.push(kasa('f2-gider', 'k8-gider', .2, E.done + 2, { step: 8, taps: ['chip', 'action', 'amount', 'text', 'drawer', 'save'] }, at => [
    { from: .2, to: at(E.form), text: 'Kasadan bir ödeme yaptıysanız: kasa düğmesi → “Gider kaydet”.' },
    { from: at(E.form), to: at(Et.drawer.on), text: 'Tutarı ve ne için ödendiğini yazın.' },
    { from: at(Et.drawer.on), to: at(Et.save.on), text: 'Para kasadan çıktıysa “Kasadan”ı seçin.' },
    { from: at(Et.save.on), to: at(E.done) + .2, text: '“Gideri kaydet”e tıklayın.' },
    { from: at(E.done) + .2, to: 99, text: 'Gider, gün sonunda kasadan düşülür.' },
  ]));

  // ===== 9. The gün sonu =====
  const S = marks('k9-gunsonu'), St = taps('k9-gunsonu');
  const notes = Object.keys(St).filter(n => /^n\d+$/.test(n));
  list.push(kasa('g1-gunsonu', 'k9-gunsonu', .2, S.closed + 2.6, { step: 9, toc: 'Gün sonu', taps: ['open', ...notes, 'pos', 'save', 'left', 'finish', 'ok'], gaps: [[St.lead.on + 1.7, St.lead.off! - .05]] }, at => [
    { from: .2, to: at(St.open.on), text: 'Akşam bütün hesaplar kapanınca bu hatırlatma çıkar.' },
    { from: at(St.open.on), to: at(S.count), text: '“Gün sonunu yap”a tıklayın.' },
    { from: at(S.count), to: at(St[notes[0]].on), text: 'Kasadaki bütün nakdi sayın.' },
    { from: at(St[notes[0]].on), to: at(St.counted.on), text: 'Her banknottan kaç adet olduğunu yazın.' },
    { from: at(St.counted.on), to: at(St.pos.on), text: 'Toplam kendiliğinden hesaplanır.' },
    { from: at(St.pos.on), to: at(St.save.on), text: 'POS cihazının gün sonu fişindeki toplamı yazın.' },
    { from: at(St.save.on), to: at(S.result) + .2, text: '“Sayımı kaydet”: sayım sonradan değiştirilemez.' },
    { from: at(S.result) + .2, to: at(St.left.on), text: 'Sayımınız işletme sahibine iletilir.<br>Beklenen tutarı ve farkı işletme sahibi görür.' },
    { from: at(St.left.on), to: at(St.finish.on), text: 'Yarın için kasada bırakılan tutarı yazın.<br>Kasadan çıkarılan tutar altında görünür.' },
    { from: at(St.finish.on), to: at(S.done) + .2, text: '“Kapanışı tamamla”ya tıklayın.' },
    { from: at(S.done) + .2, to: at(St.ok.tap!) + .15, text: 'Gün sonu kaydedildi. “Tamam”a tıklayın.' },
    { from: at(St.ok.tap!) + .45, to: 99, text: 'Kasa kapandı. QR siparişleri de o gün için kapanır.' },
  ]));
  list.push({ name: 'h0-son', duration: 7.5, card: endCardWith('Mola eğitim serisi') });
  return list;
}

// ---------- Description and thumbnail ----------
function description(list: Scene[]) {
  const { lines } = chapters(list);
  const title = 'Kasiyer eğitimi: kasa açılışı, ödeme, iade ve gün sonu | Mola';
  if (title.length > 70) throw new Error(`Başlık ${title.length} karakter.`);
  const text = `BAŞLIK (${title.length} karakter)
${title}

AÇIKLAMA
Mola adisyon ve QR menü sisteminde kasiyerin kasa ekranındaki günlük işleri adım adım gösteriliyor. Görüntüler uygulamanın kendisinden, örnek bir işletmeyle kaydedildi. Kasiyer hesabını işletme sahibi açar.

Adımlar:
1. Giriş: kullanıcı adı ve şifre → Çalışma alanını aç.
2. Kasa açılışı: kasadaki nakdi sayın → Açılışı onayla (farklıysa Farklı tutar bildir).
3. Nakit ödeme: masa → Ödeme al → Nakit, alınan para → para üstü → Ödemeyi kaydet.
4. Hesap isteği ve kart: “Hesap · Kart” isteği → masa → Ödeme al (Kart seçili) → POS → Ödemeyi kaydet.
5. Hesap bölme ve kısmi ödeme: Ödeme al → Ürün seç ya da Bir kısmı → kalanı aynı pencereden alın.
6. Masasız satış: Sipariş al → Masasız sipariş → ürünler → Gönder → ödeme → Teslim edildi.
7. İade: kasa düğmesi → İade → bugünkü ödeme → ürün, neden, yöntem → İadeyi kaydet. Kasiyerin iade sınırını işletme sahibi belirler; fazlası için sahibe istek gönderilir.
8. Gider: kasa düğmesi → Gider kaydet → tutar, açıklama, Kasadan → Gideri kaydet.
9. Gün sonu: Gün sonunu yap → banknot ve bozuk para sayımı, banka POS toplamı → Sayımı kaydet → kasada bırakılan tutar → Kapanışı tamamla. Sayım işletme sahibine iletilir; beklenen tutarı ve farkı işletme sahibi görür.

Bölümler
${lines.join('\n')}

Web: https://molayazilim.com.tr
E-posta: destek@molayazilim.com.tr

ETİKETLER
kasiyer eğitimi, kasa programı, adisyon programı, kafe adisyon, restoran adisyon, kasa açılışı, gün sonu, kasa kapanışı, hesap bölme, masasız satış, iade, gider kaydı, Mola, Mola adisyon, Mola eğitim
`;
  writeFileSync(join(dirs.out, 'aciklama.txt'), text.replace(/\n/g, '\r\n'));
  console.log(lines.join('\n'));
}
async function thumbnail(browser: Browser) {
  // The cash payment window: the bill, Nakit, the ₺500 note and the change.
  const N = taps('k3-nakit');
  const shot = join(dirs.work, 'kapak-odeme.png');
  await sharp(frameFile('k3-nakit', N.change.on + .6)).resize(1280).png().toFile(shot);
  await shootThumb(browser, trainingThumb({ title: 'Kasiyer<br>eğitimi', line: 'Kasa açılışı, ödeme,<br>iade ve gün sonu.', shot, device: 'window' }));
}

await uret({ mp4: 'Kasiyer eğitimi.mp4', music: MUSIC, description, thumbnail, scenes,
  stillsAt: process.env.KARE_SIK ? (s => Array.from({ length: Math.ceil(s.duration / 2) }, (_, i) => Math.min(s.duration - .05, i * 2 + .6))) : undefined });
