/*
 * YouTube E5 "İşletme sahibi: ilk gün" (training series #5, the last: the owner's first day after the installation): the
 * 1920×1080 video, kapak.jpg and aciklama.txt from the recordings of scripts/sosyal/youtube-sahip-kayit.ts, on the shared stage
 * of scripts/sosyal/youtube-sahne.ts (as E1–E4). No voice-over: captions and the music of scripts/sosyal/muzik.py (soft breaks
 * at the chapters), -20 LUFS.
 *
 *   npx tsx scripts/sosyal/youtube-sahip-kurgu.ts              everything (scenes → video → music → kapak.jpg, aciklama.txt)
 *   npx tsx scripts/sosyal/youtube-sahip-kurgu.ts c1 e1        only these scenes again (then the video is joined again)
 *   npx tsx scripts/sosyal/youtube-sahip-kurgu.ts --kare       a few stills per scene (layout check), no video
 *   npx tsx scripts/sosyal/youtube-sahip-kurgu.ts --kapak      only the thumbnail and the description
 *   MUZIK=cesit-7 npx tsx scripts/sosyal/youtube-sahip-kurgu.ts   another track (the scenes are kept: only the music and the
 *                                                                  join run again); default cesit-8
 *   SOSYAL_CIKTI=<klasör> …                                     another output folder
 *
 * What the installation already showed (video 06 "Kurulum": activation, the owner account, the setup wizard, a price, the
 * waiter, the tablet, the printer, the first order, Paketiniz) is one caption here. The owner's rules (18 Ekim): the logo
 * opening, then the title; the café computer's Mola window at normal size, steady; "Misafir telefonu" only briefly, where a
 * change lands; no pointer: an ordinary click is a soft ripple only; a red outline and a slight 1.2× move at most once per
 * step, only where something small must be found; a linear story, waits cut silently; a label at the top right "İşletme
 * sahibi · Adım n / 12"; plain imperative captions; the slogan of the QR share once, at the end; the closing card with
 * molayazilim.com.tr and "Mola eğitim serisi".
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import sharp from 'sharp';
import { ROOT, chapters, dirs, endCardWith, frameFile, guestScene, holdStart, introCard, marks, shootThumb, staffScene, stepped, taps, trainingThumb, uret, yer, type CaptionsOf, type Scene } from './youtube-sahne';

yer({ rec: join(ROOT, '.local', 'sosyal', 'youtube', 'sahip', 'kayit'), work: join(ROOT, '.local', 'sosyal', 'youtube', 'sahip', 'kurgu'),
  out: resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola YouTube', 'E5 İşletme sahibi ilk gün')) });
const STEPS = 12, MUSIC = process.env.MUZIK ?? 'cesit-8';
const label = (who: string) => `${who} <b>· Adım {adim} / ${STEPS}</b>`;
type Opts = { step: number; taps?: string[]; gaps?: [number, number][]; toc?: string };
/** The owner's Mola window, every caption carrying the step for the top-right label. */
function screen(name: string, clip: string, from: number, to: number, o: Opts, captions: CaptionsOf): Scene {
  return staffScene(name, clip, from, to, { frame: 'win', title: 'Mola · İşletme yönetimi', tag: label('İşletme sahibi'), taps: o.taps, gaps: o.gaps },
    (at, d) => stepped(o.step, captions(at, d)), o.toc);
}
/** The guest's phone, briefly: where a change to the menu shows. */
function phone(name: string, clip: string, from: number, to: number, o: Opts, captions: CaptionsOf): Scene {
  return { ...guestScene(name, clip, from, to, o.taps ?? [], (at, d) => stepped(o.step, captions(at, d)), o.toc), tag: label('Misafir telefonu') };
}
function scenes(): Scene[] {
  const list: Scene[] = [];
  list.push({ name: 'a0-giris', duration: 8, card: introCard('İşletme sahibi: ilk gün', 'Kurulumdan sonraki ilk gün, adım adım.'), toc: 'Giriş ve menü' });

  // ===== 1. The order of the categories =====
  const K = marks('s1-kategori'), Kt = taps('s1-kategori');
  list.push(holdStart(screen('b1-kategori', 's1-kategori', .2, K.saved + 2.8, { step: 1, taps: ['nav', 'open', '!up', 'save'] }, at => [
    { from: .2, to: at(Kt.nav.tap!) - .2, text: 'Kurulum için Kurulum videosuna bakın.' },
    { from: at(Kt.nav.tap!) - .2, to: at(K.menu), text: 'Önce menüyü işletmenize göre düzenleyin: “Menü yönetimi”.' },
    { from: at(K.menu), to: at(K.modal), text: '“Kategoriler ve sıra”ya tıklayın.' },
    { from: at(K.modal), to: at(Kt.up.on), text: 'Müşteri menüde sekmeleri bu sırayla görür.' },
    { from: at(Kt.up.on), to: at(Kt.save.on), text: 'Bir kategoriyi okla yukarı ya da aşağı taşıyın.' },
    { from: at(Kt.save.on), to: at(K.saved) + .2, text: '“Sırayı kaydet”e tıklayın.' },
    { from: at(K.saved) + .2, to: 99, text: 'Müşteri menüsü bu sırayla açılır.' },
  ]), 1.8));

  // ===== 2. A new product with its photo =====
  const U = marks('s2-urun'), Ut = taps('s2-urun');
  list.push(screen('c1-urun', 's2-urun', .2, U.end - .2, { step: 2, taps: ['add', 'name', 'category', 'price', 'photo', 'use'] }, at => [
    { from: .2, to: at(U.editor), text: 'Yeni ürün için “Ürün ekle”ye tıklayın.' },
    { from: at(U.editor), to: at(Ut.price.on), text: 'Ürünün adını yazın ve kategorisini seçin.' },
    { from: at(Ut.price.on), to: at(Ut.photo.on), text: 'Fiyatını yazın.' },
    { from: at(Ut.photo.on), to: at(U.crop), text: '“Fotoğraf seç” ile bilgisayardan fotoğrafı seçin.' },
    { from: at(U.crop), to: at(Ut.use.on), text: 'Fotoğraf kare kırpılır; gerekirse yakınlaştırın.' },
    { from: at(Ut.use.on), to: at(U.photo), text: '“Fotoğrafı kullan”a tıklayın.' },
    { from: at(U.photo), to: 99, text: 'Fotoğraf ürüne eklenir.' },
  ]));

  // ===== 3. A choice for the guest; "Tükendi" =====
  const S = marks('s3-secenek'), St = taps('s3-secenek');
  list.push(screen('c2-secenek', 's3-secenek', .2, S.end - .2, { step: 3, taps: ['options', 'service', 'extra', 'save', 'search', '!soldout'], gaps: [[St.row.on + 1.4, St.row.off! - .05]] }, at => [
    { from: .2, to: at(St.service.on), text: 'Boy, süt ya da servis tercihi için “Müşteri seçenekleri”.' },
    { from: at(St.service.on), to: at(St.extra.on), text: '“Servis tercihi ekle”: Sade ve Dondurmalı gelir.' },
    { from: at(St.extra.on), to: at(St.save.on), text: 'Seçeneğin ek ücretini yazın.' },
    { from: at(St.save.on), to: at(S.saved) + .2, text: '“Kaydet ve yayınla”ya tıklayın.' },
    { from: at(S.saved) + .2, to: at(St.soldout.on), text: 'Ürün menüde yayında.' },
    { from: at(St.soldout.on), to: 99, text: 'Biten ürün için “Tükendi”yi işaretleyin; sipariş verilemez.' },
  ]));
  list.push(phone('c3-telefon', 'q3-menu', .4, marks('q3-menu').end - .2, { step: 3 }, () => [
    { from: .2, to: 99, text: 'Müşterinin menüsünde<br>yeni sıra ve yeni ürün<br>fotoğrafıyla görünür.' },
  ]));

  // ===== 4. The staff accounts =====
  const P = marks('s4-calisan'), Pt = taps('s4-calisan');
  list.push(screen('d1-calisan', 's4-calisan', .2, P.end - .4, { step: 4, toc: 'Çalışanlar', taps: ['nav', 'add', 'name', 'role', 'pass', 'create', '!reset'], gaps: [[P.created + 1.4, P.card - .1], [Pt.card.on + 2.8, Pt.reset.on - .05]] }, at => [
    { from: .2, to: at(Pt.list.on), text: 'Her çalışana kendi hesabını açın: “Personel”.' },
    { from: at(Pt.list.on), to: at(Pt.add.on), text: 'Garson sipariş alır, mutfak hazırlar;<br>kasiyer ödeme alır, kasayı açıp kapatır.' },
    { from: at(Pt.add.on), to: at(P.form), text: '“Çalışan ekle”ye tıklayın.' },
    { from: at(P.form), to: at(Pt.role.on), text: 'Adını yazın; kullanıcı adı kendiliğinden oluşur.' },
    { from: at(Pt.role.on), to: at(Pt.pass.on), text: 'Görevini seçin. Müdür, siz yokken günü yönetir.' },
    { from: at(Pt.pass.on), to: at(Pt.create.on), text: 'Bir şifre belirleyin: en az 10 karakter.' },
    { from: at(Pt.create.on), to: at(P.created) + .2, text: '“Hesabı oluştur”a tıklayın.' },
    { from: at(P.created) + .2, to: at(Pt.reset.on), text: 'Hesap hazır. Ayarlar yalnız sizdedir;<br>Müdür için Müdür eğitimi videosuna bakın.' },
    { from: at(Pt.reset.on), to: 99, text: 'Şifresini unutan çalışana “Şifreyi yenile” ile yeni şifre verin.' },
  ]));

  // ===== 5. Ayarlar → İşletme → Görünüm =====
  const G = marks('s5-gorunum'), Gt = taps('s5-gorunum');
  list.push(screen('e1-gorunum', 's5-gorunum', .2, G.end - .6, { step: 5, toc: 'Ayarlar', taps: ['nav', 'topic', 'part'], gaps: [[Gt.topics.on + 2, Gt.topics.off! - .05], [Gt.look.on + 2.6, Gt.look.off! - .05]] }, at => [
    { from: .2, to: at(G.page), text: 'Ayarları bir kez yapın: “Ayarlar”.' },
    { from: at(G.page), to: at(Gt.look.on), text: 'Konular üstte sıralanır.' },
    { from: at(Gt.look.on), to: at(Gt.palette.on), text: 'İşletme → Görünüm: işletmenin adı ve logosu.' },
    { from: at(Gt.palette.on), to: 99, text: 'Renk paleti müşteri menüsünde de kullanılır.' },
  ]));

  // ===== 6. Masalar ve QR =====
  const M = marks('s6-masa'), Mt = taps('s6-masa');
  list.push(screen('e2-masa', 's6-masa', .2, M.end - .8, { step: 6, taps: ['topic', 'part', 'add', 'area', 'create', 'print', 'a6'], gaps: [[Mt.new.on + 2.4, Mt.new.off! - .05]] }, at => [
    { from: .2, to: at(Mt.add.on), text: '“Masalar ve QR”: masalar ve bölümleri.' },
    { from: at(Mt.add.on), to: at(M.modal), text: 'Yeni masa için “Masa ekle”.' },
    { from: at(M.modal), to: at(M.added) + .2, text: 'Bölümünü seçip “Yeni masayı oluştur”a tıklayın.' },
    { from: at(M.added) + .2, to: at(Mt.print.on), text: 'Yeni masa kendi QR koduyla eklenir.' },
    { from: at(Mt.print.on), to: at(Mt.go.on), text: '“QR kodlarını yazdır”: A4’e 6 ya da 12 QR, ya da A6 masa standı.' },
    { from: at(Mt.go.on), to: 99, text: '“Yazdır” ile basın; her masaya kendi kodunu koyun.' },
  ]));

  // ===== 7. Sipariş ve mutfak (video 01) =====
  const O = marks('s7-siparis'), Ot = taps('s7-siparis');
  list.push(screen('e3-siparis', 's7-siparis', .2, O.end - .9, { step: 7, taps: ['topic', 'part'], gaps: [[Ot.pay.on + 2.8, Ot.pay.off! - .05]] }, at => [
    { from: .2, to: at(Ot.qr.on), text: '“Sipariş ve mutfak”: ödeme sırası, değiştirme süresi ve QR onayı.' },
    { from: at(Ot.qr.on), to: 99, text: 'Bu ayarlar için “QR menü ve QR sipariş” videosuna bakın.' },
  ]));

  // ===== 8. Kasa ayarları =====
  const A = marks('s8-kasa'), At = taps('s8-kasa');
  list.push(screen('e4-kasa', 's8-kasa', .2, A.end - .2, { step: 8, taps: ['nav', 'tab', 'limits', 'card', '!toggle'], gaps: [[At.refund.on + 3, At.refund.off! - .05], [At.lead.on + 1.4, At.lead.off! - .05]] }, at => [
    { from: .2, to: at(A.limits), text: '“Kasa ve giderler” → “Kasa ayarları”.' },
    { from: at(A.limits), to: at(At.card.on), text: '“Kasiyer yetkileri”: kasiyerin kendi yapabileceği en yüksek iade.' },
    { from: at(At.card.on), to: at(At.toggle.on), text: '“Kart ve yazar kasa”: POS komisyonu ve yazar kasa.' },
    { from: at(At.toggle.on), to: at(A.on) + .2, text: 'Yazar kasa kullanıyorsanız “Yazar kasa yardımcısı”nı açın.' },
    { from: at(A.on) + .2, to: 99, text: 'Her ödemeden sonra yazar kasaya girilecek tutar gösterilir.' },
  ]));

  // ===== 9. Uzaktan erişim =====
  const R = marks('s9-uzak'), Rt = taps('s9-uzak');
  list.push(screen('e5-uzak', 's9-uzak', .2, R.end - .6, { step: 9, taps: ['nav', 'topic'], gaps: [[Rt.cards.on + 2.6, Rt.cards.off! - .05]] }, at => [
    { from: .2, to: at(R.page), text: 'Ayarlar → “Uzaktan erişim”.' },
    { from: at(R.page), to: at(R.down) - .8, text: 'Raporlarınıza ve kafenize her yerden ulaşırsınız.' },
    { from: at(R.down) - .8, to: 99, text: 'Telefondan yönetmek için Uzaktan erişim videosuna bakın.' },
  ]));

  // ===== 10. Mola Yardım =====
  const Y = marks('s10-yardim'), Yt = taps('s10-yardim');
  list.push(screen('f1-yardim', 's10-yardim', .2, Yt.close.on - 1.8, { step: 10, toc: 'Yardım ve destek', taps: ['help', 'ask'] }, at => [
    { from: .2, to: at(Y.panel), text: 'Takıldığınızda sağ üstteki “Yardım”a tıklayın.' },
    { from: at(Y.panel), to: at(Y.answer), text: 'Sorunuzu yazın.' },
    { from: at(Y.answer), to: 99, text: 'Mola Yardım cevabı hemen gösterir.' },
  ]));

  // ===== 11. Destek =====
  const D = marks('s11-destek'), Dt = taps('s11-destek');
  list.push(screen('f2-destek', 's11-destek', .2, D.end - 1.2, { step: 11, taps: ['nav', 'remote'], gaps: [[Dt.tickets.on + 2.4, Dt.tickets.off! - .05]] }, at => [
    { from: .2, to: at(D.page), text: 'Mola ekibine yazmak için “Destek”.' },
    { from: at(D.page), to: at(D.contact), text: '“Yeni talep” ile yazın; yanıt buraya gelir.' },
    { from: at(D.contact), to: at(Dt.remote.on), text: 'E-posta ve web adresimiz altta yazar.' },
    { from: at(Dt.remote.on), to: 99, text: '“Mola desteği”: ekranınıza bakmamız gerekirse izni siz açarsınız.' },
  ]));

  // ===== 12. The first day's report =====
  const Z = marks('s12-rapor'), Zt = taps('s12-rapor');
  list.push(screen('g1-rapor', 's12-rapor', .2, Z.end - 1, { step: 12, toc: 'İlk günün raporu', taps: ['nav', 'detail', 'people'], gaps: [[Zt.sentence.on + 3.6, Zt.sentence.off! - .05], [Zt.grid.on + 3, Zt.grid.off! - .05]] }, at => [
    { from: .2, to: at(Zt.sentence.on), text: 'Akşam “Satış ve Raporlar”a tıklayın.' },
    { from: at(Zt.sentence.on), to: at(Zt.grid.on), text: 'Bugünkü sipariş ve satış tek cümlede yazar.' },
    { from: at(Zt.grid.on), to: at(Zt.detail.on), text: 'Altında satış, giderler, elde kalan ve sipariş sayısı.' },
    { from: at(Zt.detail.on), to: at(Z.donut), text: '“Detaylı göster”, sonra “Personel”.' },
    { from: at(Z.donut), to: 99, text: 'Siparişlerinizin ne kadarını QR ile alıyorsunuz?<br>30 günde görün.' },
  ]));
  list.push({ name: 'j0-son', duration: 7.5, card: endCardWith('Mola eğitim serisi') });
  return list;
}

// ---------- Description and thumbnail ----------
function description(list: Scene[]) {
  const { lines } = chapters(list);
  const title = 'İşletme sahibi ilk gün: menü, çalışanlar, ayarlar ve rapor | Mola';
  if (title.length > 70) throw new Error(`Başlık ${title.length} karakter.`);
  const text = `BAŞLIK (${title.length} karakter)
${title}

AÇIKLAMA
Mola adisyon ve QR menü sisteminde işletme sahibinin kurulumdan sonraki ilk gün yaptığı işler adım adım gösteriliyor. Görüntüler uygulamanın kendisinden, örnek bir işletmeyle kaydedildi. İndirme, etkinleştirme, sahip hesabı, kurulum sihirbazı, garson tableti, yazıcı ve ilk sipariş Kurulum videosunda anlatılıyor.

Adımlar:
1. Kategori sırası: Menü yönetimi → Kategoriler ve sıra → ok ile taşıyın → Sırayı kaydet. Müşteri menüsü bu sırayla açılır.
2. Yeni ürün: Ürün ekle → ad, kategori, fiyat → Fotoğraf seç → Fotoğrafı kullan.
3. Seçenekler: Müşteri seçenekleri → Boy, Süt tercihi, Servis tercihi ya da Özel alan; ek ücret → Kaydet ve yayınla. Biten ürün için Tükendi.
4. Çalışanlar: Personel → Çalışanlar → Çalışan ekle → ad soyad, görevi (Garson, Kasiyer, Mutfak, Müdür), şifre → Hesabı oluştur. Unutulan şifre için Şifreyi yenile.
5. Görünüm: Ayarlar → İşletme → Görünüm: işletme adı, logo, renk paleti, menü karşılama alanı.
6. Masalar ve QR: Masa ekle → bölüm → Yeni masayı oluştur. QR kodlarını yazdır: A4'e 6 ya da 12 QR, A6 masa standı.
7. Sipariş ve mutfak: ödeme sırası, değiştirme süresi, QR onayı. Ayrıntılar QR menü ve QR sipariş videosunda.
8. Kasa ayarları: Kasa ve giderler → Kasa ayarları → Kasiyer yetkileri (kasiyerin en yüksek iadesi) ve Kart ve yazar kasa (POS komisyonu, Yazar kasa yardımcısı).
9. Uzaktan erişim: Ayarlar → Uzaktan erişim. Telefondan yönetim ayrı videoda anlatılır.
10. Mola Yardım: sağ üstteki Yardım → sorunuzu yazın.
11. Destek: Destek → Talepler → Yeni talep; ekranınıza bakmamız gerekirse izni Destek → Mola desteği'nde siz açarsınız.
12. İlk günün raporu: Satış ve Raporlar (Bugün) → Detaylı göster → Personel: QR sipariş payı.

Bölümler
${lines.join('\n')}

Web: https://molayazilim.com.tr
E-posta: destek@molayazilim.com.tr

ETİKETLER
işletme sahibi, kafe yönetimi, restoran yönetimi, adisyon programı, kafe adisyon, QR menü, QR sipariş, menü düzenleme, çalışan hesabı, masa QR kodu, yazar kasa, satış raporu, Mola, Mola eğitim
`;
  writeFileSync(join(dirs.out, 'aciklama.txt'), text.replace(/\n/g, '\r\n'));
  console.log(lines.join('\n'));
}
async function thumbnail(browser: Browser) {
  // Satış ve Raporlar → Personel: the QR share.
  const shot = join(dirs.work, 'kapak-rapor.png');
  await sharp(frameFile('s12-rapor', taps('s12-rapor').donut.on + .8)).resize(1280).png().toFile(shot);
  await shootThumb(browser, trainingThumb({ title: 'İşletme<br>sahibi:<br>ilk gün', line: 'Menü, çalışanlar,<br>ayarlar ve rapor.', shot, device: 'window' }));
}

await uret({ mp4: 'İşletme sahibi ilk gün.mp4', music: MUSIC, description, thumbnail, scenes,
  stillsAt: process.env.KARE_SIK ? (s => Array.from({ length: Math.ceil(s.duration / 2) }, (_, i) => Math.min(s.duration - .05, i * 2 + .6))) : undefined });
