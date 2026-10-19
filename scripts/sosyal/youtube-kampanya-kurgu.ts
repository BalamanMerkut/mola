/*
 * YouTube 04 "Kampanyalar ve rezervasyon" (introduction series): the 1920×1080 video, kapak.jpg and aciklama.txt from the
 * recordings of scripts/sosyal/youtube-kampanya-kayit.ts, on the shared stage of scripts/sosyal/youtube-sahne.ts. No
 * voice-over: captions and the music of scripts/sosyal/muzik.py (soft breaks at the chapters), -20 LUFS.
 *
 *   npx tsx scripts/sosyal/youtube-kampanya-kurgu.ts              everything (scenes → video → music → kapak.jpg, aciklama.txt)
 *   npx tsx scripts/sosyal/youtube-kampanya-kurgu.ts c1 f3        only these scenes again (then the video is joined again)
 *   npx tsx scripts/sosyal/youtube-kampanya-kurgu.ts --kare       a few stills per scene (layout check), no video
 *   npx tsx scripts/sosyal/youtube-kampanya-kurgu.ts --kapak      only the thumbnail and the description
 *   MUZIK=cesit-17 npx tsx scripts/sosyal/youtube-kampanya-kurgu.ts   another track (the scenes are kept: only the music and
 *                                                                   the join run again); default cesit-13 (Do majör, 108 tempo)
 *   SOSYAL_CIKTI=<klasör> …                                       another output folder
 *
 * One linear story for an owner who weighs Mola, as videos 01–03, kept under 5 minutes: a time-limited campaign written in
 * Menü yönetimi → Kampanyalar (its form full screen, "Saat aralığı ekle" outlined), a gift campaign (its example line and
 * the list), the guest's menu at 15:00 and one before/after split, the waiter's tablet (the campaign price, "Kampanya: Türk
 * Kahvesi bedava · Ekle"), the bill on the counter, "Kampanya bitti" when the quota is used up and the campaign report; then
 * a reservation with kapora, the setting "Rezervasyondan kaç dakika önce masa ayrılsın" full screen (outlined) and its effect
 * on Masalar as one split, the guest seated with the kapora on the bill; a match evening with temporary tables, closed, and
 * the reservation report. (The recorder's g2-rezerve, the guest's phone at the held table, is not in this cut.) The owner's rules (18–19 Ekim): the logo opening, then the title; no pointer: an ordinary click is a soft ripple
 * only; a red outline at most once per step, only where something small must be found; a label at the top right
 * "İşletme sahibi · Adım n / 7", "Misafir telefonu", "Garson tableti", "Kasa ekranı", "Karşılaştırma"; short plain
 * captions; "30 gün ücretsiz deneme" on the closing card only.
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import { C, ROOT, chapters, dirs, endCard, fmt, guestScene, holdEnd, holdStart, introCard, introThumb, THUMB_TONES, marks, meta, ownerScene, screenSplitScene, shootThumb, splitScene, staffScene, stepped, taps, uret, yer, type Box, type CaptionsOf, type Scene } from './youtube-sahne';

yer({ rec: join(ROOT, '.local', 'sosyal', 'youtube', 'kampanya', 'kayit'), work: join(ROOT, '.local', 'sosyal', 'youtube', 'kampanya', 'kurgu'),
  out: resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola YouTube', '04 Kampanyalar ve rezervasyon')) });
const STEPS = 7, MUSIC = process.env.MUZIK ?? 'cesit-13';
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
/** A staff device on its own: the waiter's tablet or the counter's Mola window. */
function device(name: string, clip: string, from: number, to: number, who: 'tablet' | 'kasa', o: { taps?: string[]; gaps?: [number, number][]; toc?: string }, captions: CaptionsOf): Scene {
  return staffScene(name, clip, from, to, who === 'tablet' ? { frame: 'tablet', tag: 'Garson tableti', taps: o.taps, gaps: o.gaps } : { frame: 'win', title: 'Mola · İşletme yönetimi', tag: 'Kasa ekranı', taps: o.taps, gaps: o.gaps }, captions, o.toc);
}
/** The guest's phone, big and steady, captions at the side. */
function phone(name: string, clip: string, from: number, to: number, names: string[], captions: CaptionsOf, toc?: string): Scene {
  return { ...guestScene(name, clip, from, to, names, captions, toc), tag: 'Misafir telefonu', side: 'guest' };
}

/** Every recorded tap of a clip (ordinary: a ripple); `outlined` ones get the red outline and the slight move. */
const clicks = (clip: string, ...outlined: string[]) => Object.values(taps(clip)).filter(t => t.tap !== undefined).map(t => outlined.includes(t.name) ? `!${t.name}` : t.name);

function scenes(): Scene[] {
  const list: Scene[] = [];
  list.push({ name: 'a0-giris', duration: 8, card: introCard('Kampanyalar ve rezervasyon', 'Kampanya türleri, misafir menüsü ve hesap; rezervasyon, kapora ve etkinlik.'), toc: 'Giriş ve kampanya oluşturma' });

  // ===== 1. Kampanyalar and a new campaign: İkindi kahvesi (the form full screen, "Saat aralığı ekle" outlined) =====
  const A = marks('c1-kampanya'), At = taps('c1-kampanya');
  list.push(screen('b1-liste', 'c1-kampanya', .2, At.add.tap! + .6, { step: 1, taps: clicks('c1-kampanya'), gaps: [[At.tab.tap! - .02, At.tab.tap! + .16], [At.states.on + 2.4, At.states.off!], [At.cards.on, At.cards.off! + .1]] }, at => [
    { from: .2, to: at(A.list), text: 'Menü yönetimi → Kampanyalar.' },
    { from: at(A.list), to: 99, text: 'Durumlar: Taslak, Planlandı, Aktif, Bitti. Onay beklenmez.' },
  ]));
  list.push(holdEnd(setting('b2-form', 'c1-kampanya', At.add.tap! + .6, At.card.on + 1.8, 1, clicks('c1-kampanya', 'window'), at => [
    { from: .2, to: at(A.percent), text: '“Kampanya ekle”: adı yazılır.' },
    { from: at(A.percent), to: at(A.scope), text: 'Türler: yüzde, TL, X al Y öde, ikincisi indirimli, hediye ürün.' },
    { from: at(A.scope), to: at(A.when), text: 'Yüzde indirim %20; seçilen ürünlere ya da bir bölüme: Kahveler.' },
    { from: at(A.when), to: at(At.window.on), text: 'Ne zaman: tarih aralığı, her hafta ya da her ay.' },
    { from: at(At.window.on), to: at(A.limit), text: '“Saat aralığı ekle”: yalnız 14:00–17:00 arasında geçerli.' },
    { from: at(A.limit), to: at(A.status), text: 'Toplam adet sınırı: 30 kahve verilince kampanya biter.' },
    { from: at(A.status), to: at(A.saved), text: 'Misafirin menüde ne göreceği formun yanında görünür.' },
    { from: at(A.saved), to: 99, text: 'Kaydedilir; saati gelince kendiliğinden uygulanır.' },
  ], { gaps: [[A.kinds - .1, A.percent - .1], [At.covered.on + 1.2, At.covered.off!], [At.summary.on + 2, At.summary.off!], [At.preview.on + 2, At.preview.off!]] }), .6));

  // ===== 2. A gift campaign (its example line, then the list) =====
  const G = marks('c2-hediye'), Gt = taps('c2-hediye');
  list.push(screen('b3-hediye', 'c2-hediye', G.example - .05, G.end - .2, { step: 2, taps: clicks('c2-hediye'), gaps: [[Gt.preview.on, Gt.save.on]] }, at => [
    { from: .2, to: at(G.saved), text: 'İkinci kampanya, hediye ürün: tatlılarda 2 adet alana Türk Kahvesi.' },
    { from: at(G.saved), to: 99, text: 'İki kampanya birlikte çalışır.' },
  ]));

  // ===== The guest's menu at 15:00, one before / after split =====
  const M = marks('g1-misafir'), Mt = taps('g1-misafir');
  list.push({ ...phone('c1-misafir', 'g1-misafir', .2, Mt.grid.off! - .1, clicks('g1-misafir'), at => [
    { from: .2, to: at(M.offers), text: 'Saat 15:00.<br>Misafir masadaki QR’ı okuttu.' },
    { from: at(M.offers), to: at(M.scrolled), text: '“Kampanyalı ürünler”:<br>kampanya ve kalan adet.' },
    { from: at(M.scrolled), to: at(M.kahveler), text: 'Hediye kampanyası da<br>ürünün üstünde yazar.' },
    { from: at(M.kahveler), to: 99, text: 'Kahvelerde eski fiyat<br>çizili, yenisi yanında.' },
  ], 'Misafir menüsü, garson ve hesap') });
  const Bt = taps('g0-once');
  list.push(splitScene('c2-karsilastirma', '“Saat aralığı ekle”: misafir menüsü',
    { clip: 'g0-once', t: Bt.grid.on + 1.5, label: 'Saat aralığı dışında · 13:40', tone: 'off' },
    { clip: 'g1-misafir', t: Mt.grid.on + 1.5, label: 'Saat aralığında · 15:00', tone: 'on' },
    'Saat aralığı dışında menü fiyatı; içinde %20 indirim.', 8));

  // ===== The waiter's tablet: the campaign price, the gift hint =====
  const T = marks('t1-garson'), Tt = taps('t1-garson');
  list.push(device('c3-garson', 't1-garson', .4, T.end - .3, 'tablet', { taps: clicks('t1-garson'),
    gaps: [[Tt.prices.on + 2, Tt['cat2'].on + .1], [Tt['ss-card'].on, Tt.hint.on - .1], [Tt.hint.on + 2.2, Tt.hint.off!], [Tt.basket.on + 2.4, Tt.basket.off!]] }, at => [
    { from: .2, to: at(T.prices), text: 'Garson Masa 04’ün siparişini alır.' },
    { from: at(T.prices), to: at(Tt.prices.on + 2), text: 'Garson ekranında da kampanyalı fiyat: Caffè Latte ₺112.' },
    { from: at(Tt.prices.on + 2), to: at(Tt.gift.tap!), text: '2 tatlı eklenince: “Kampanya: Türk Kahvesi bedava · Ekle”.' },
    { from: at(Tt.gift.tap!), to: at(T.basket), text: '“Ekle”: hediye sepete girer.' },
    { from: at(T.basket), to: 99, text: 'Sepette kampanya indirimi ayrı satırda görünür.' },
  ]));

  // ===== The bill on the counter =====
  const K = marks('k1-kasa'), Kt = taps('k1-kasa');
  list.push(holdEnd(device('c4-kasa', 'k1-kasa', .2, Kt.lines.off! + .2, 'kasa', { taps: clicks('k1-kasa') }, at => [
    { from: .2, to: at(K.bill), text: 'Kasada Masa 04’ün hesabı.' },
    { from: at(K.bill), to: 99, text: 'Her satırda uygulanan kampanya; hediye “−₺76” ile düşülür.' },
  ]), .4));

  // ===== 3. The quota used up: "Kampanya bitti", the campaign report =====
  const O = marks('o1-bitti'), Ot = taps('o1-bitti'), om = meta('o1-bitti');
  // The list refreshes with the last coffees (the card moves to "Biten kampanyalar", the notification comes up).
  const filled = om.frames.map(f => f.t - om.marks.start).find(t => t > Ot.quota.off! + .1) ?? O.full;
  list.push(screen('d1-bitti', 'o1-bitti', .2, O.products - .3, { step: 3, toc: 'Kampanya bitti ve rapor', taps: clicks('o1-bitti'),
    gaps: [[Ot.quota.on + 2.4, filled - .5], [filled + 2.8, O.ended - .6], [Ot.figures.on + 4, Ot.figures.off!], [Ot.summary.on + 2.6, Ot.summary.off!]] }, at => [
    { from: .2, to: at(filled - .5), text: 'Kartta kullanılan ve kalan adet: 27 / 30.' },
    { from: at(filled - .5), to: at(O.ended), text: '30 adet dolunca kampanya biter; bildirim gelir.' },
    { from: at(O.ended), to: at(O.report), text: '“Kampanya bitti”: satılan adet, ciro ve verilen indirim.' },
    { from: at(O.report), to: 99, text: 'Satış ve Raporlar → Kampanyalar: önceki haftalarla karşılaştırma.' },
  ]));

  // ===== 4. A reservation with kapora =====
  const R = marks('r1-rezerv'), Rt = taps('r1-rezerv');
  list.push(screen('e1-rezerv', 'r1-rezerv', .2, Rt.list.on + 2.4, { step: 4, toc: 'Rezervasyon ve kapora', taps: clicks('r1-rezerv'),
    gaps: [[Rt.planLook.on + 1, Rt.planLook.off!], [Rt.note.on, R.deposit - .1], [Rt.method.on + 1, Rt.method.off!], [Rt.tile.on + 2, Rt.tile.off!]] }, at => [
    { from: .2, to: at(R.plan), text: 'Ajanda ve rezervasyon → Rezervasyonlar.' },
    { from: at(R.plan), to: at(R.form), text: 'Masa planı: saat seçilir, boş masaya dokunulur.' },
    { from: at(R.form), to: at(R.deposit), text: 'Misafir adı, kişi sayısı; isterseniz telefon ve not.' },
    { from: at(R.deposit), to: at(R.saved), text: '“Kapora alındı”: tutar ve nakit ya da kart.' },
    { from: at(R.saved), to: at(R.list), text: 'Masa o saat için “Rezerve” görünür.' },
    { from: at(R.list), to: 99, text: 'Günün rezervasyonları ve kapora altta listelenir.' },
  ]));

  // ===== 5. The setting: Rezervasyondan kaç dakika önce masa ayrılsın (full screen); its effect; before / after =====
  const S = marks('s1-ayar'), St = taps('s1-ayar');
  list.push(holdEnd(setting('e2-ayar', 's1-ayar', .2, St.line.on + 3, 5, clicks('s1-ayar', 'hold'), at => [
    { from: .2, to: at(S.card), text: 'Ayar: Ajanda ve rezervasyon → Ayarlar.' },
    { from: at(S.card), to: at(St.hold.on), text: 'Masa, rezervasyon saatinden bu kadar önce ayrılır. Varsayılan: 30 dk.' },
    { from: at(St.hold.on), to: at(S.set), text: '“1 saat önce” seçilir.' },
    { from: at(S.set), to: 99, text: 'Masada “Rezerve” görünür; masanın QR’ından yeni sipariş verilmez.' },
  ], { gaps: [[St.row.on + 2.4, St.row.off!]] }), 1));
  const before = taps('t2-once'), after = taps('t3-sonra');
  // Masa 05's card with a little air around it, the same window on both sides (the held card is the taller one).
  const tall = after.card.box, air = (card: Box) => ({ x: card.x - 14, y: card.y - 14, width: tall.width + 28, height: tall.height + 28 });
  const left = air(before.card.box), right = air(after.card.box);
  list.push(screenSplitScene('e5-karsilastirma', 'Masa ayırma süresi · saat 18:35', 'Garson tableti · Masalar',
    { clip: 't2-once', t: before.card.on + 1.5, label: 'Varsayılan · 30 dk önce', region: left },
    { clip: 't3-sonra', t: after.card.on + 1.5, label: '1 saat önce', region: right },
    '19:30 rezervasyonu: 30 dakikada masa henüz boş; 1 saatte ayrılmış.', 8));

  // ===== The guest comes: Geldi, the kapora on the bill =====
  const V = marks('t4-geldi'), Vt = taps('t4-geldi');
  list.push(device('e6-geldi', 't4-geldi', .2, V.end - .2, 'tablet', { taps: clicks('t4-geldi'), gaps: [[Vt.panel.on + 2.4, Vt.panel.off!], [Vt.guest.on + 1.8, V.ordered - .2], [Vt.deposit.on + 3, Vt.deposit.off!]] }, at => [
    { from: .2, to: at(Vt.seat.on), text: '19:20: misafir geldi. Masada rezervasyon ve kapora.' },
    { from: at(Vt.seat.on), to: at(V.ordered), text: '“Geldi”: misafirin adı masaya ve hesaba geçer.' },
    { from: at(V.ordered), to: at(V.deposit), text: 'Sipariş her zamanki gibi alınır.' },
    { from: at(V.deposit), to: 99, text: 'Kapora hesaptan kendiliğinden düşülür.' },
  ]));

  // ===== 6. A match evening: an event with temporary tables =====
  const E = marks('e1-etkinlik'), Et = taps('e1-etkinlik');
  list.push(screen('f1-etkinlik', 'e1-etkinlik', .2, Et.card.on + 2.2, { step: 6, toc: 'Maç günü: etkinlik', taps: clicks('e1-etkinlik'),
    gaps: [[Et.lead.on + 1.2, Et.lead.off!], [Et.day.on, E.when - .1], [Et.whenLine.on + 1.8, Et.whenLine.off!], [Et.chips.on + 2, Et.screen.off!]] }, at => [
    { from: .2, to: at(E.events), text: 'Ajanda ve rezervasyon → Etkinlikler.' },
    { from: at(E.events), to: at(E.form), text: 'Maç günü, konser gibi akşamlar için geçici masalar.' },
    { from: at(E.form), to: at(E.tables), text: 'Etkinlik adı, gün ve saat.' },
    { from: at(E.tables), to: at(E.names), text: 'Kaç geçici masa açılacağı: 12, masa başı 4 kişi.' },
    { from: at(E.names), to: at(Et.save.on), text: 'Masalar D1, D2… diye adlandırılır; QR’ları yoktur.' },
    { from: at(Et.save.on), to: 99, text: 'Masalara önceden rezervasyon yazılabilir.' },
  ]));
  const F = marks('t5-etkinlik');
  list.push(device('f2-masalar', 't5-etkinlik', .2, F.window - 3.3, 'tablet', {}, at => [
    { from: .2, to: at(F.section), text: 'Maç günü 20:30: etkinlik kendiliğinden başlar.' },
    { from: at(F.section), to: 99, text: 'Geçici masalar Masalar ekranında kendi bölümünde; misafir adlarıyla.' },
  ]));

  // ===== 7. The event closed; the reservation report =====
  const Z = marks('e2-kapat'), Zt = taps('e2-kapat');
  list.push(holdEnd(screen('f3-kapat', 'e2-kapat', .2, Zt.events.on + 3.2, { step: 7, toc: 'Etkinlik ve rezervasyon raporu', taps: clicks('e2-kapat'),
    gaps: [[Zt.card.on + 2.2, Zt.card.off!], [Zt.confirm.on + 2, Zt.confirm.off!], [Zt.notice.on + 1.2, Zt.notice.off!], [Zt.kpi.on + 2.6, Zt.kpi.off!], [Zt.deposits.on + 1.8, Zt.deposits.off!]] }, at => [
    { from: .2, to: at(Zt.close.on), text: 'Hesaplar kapanınca etkinlik kapatılır.' },
    { from: at(Zt.close.on), to: at(Z.closed), text: 'Gelmeyen rezervasyon “gelmedi” olarak işaretlenir.' },
    { from: at(Z.closed), to: at(Z.report), text: 'Geçici masalar kalkar; satışlar raporda kalır.' },
    { from: at(Z.report), to: at(Z.events), text: 'Rezervasyon raporu: gelen, gelmeyen, kapora.' },
    { from: at(Z.events), to: 99, text: 'Etkinlik: kullanılan masa, kişi, satış ve kapora.' },
  ]), .6));
  list.push({ name: 'g0-son', duration: 7.5, card: endCard });
  return list;
}

// ---------- Description and thumbnail ----------
function description(list: Scene[]) {
  const { lines, total } = chapters(list);
  const title = 'Kampanyalar ve rezervasyon: indirim, kapora, etkinlik | Mola';
  if (title.length > 70) throw new Error(`Başlık ${title.length} karakter.`);
  const text = `BAŞLIK (${title.length} karakter)
${title}

AÇIKLAMA
Bu videoda Mola adisyon ve QR menü sisteminde kampanyalar, rezervasyon ve etkinlikler gösteriliyor. Görüntüler uygulamanın kendisinden, örnek bir işletmeyle kaydedildi.

Videoda:
- Menü yönetimi → Kampanyalar: kampanya durumları (Taslak, Planlandı, Aktif, Bitti); kampanya onay beklemez, zamanı gelince kendiliğinden başlar.
- Kampanya türleri: yüzde indirim, TL indirimi, X al Y öde, ikincisi indirimli, hediye ürün. Seçilen ürünlere ya da menüdeki bir bölümün tamamına uygulanır.
- Zamanlama: tarih aralığı, her hafta ya da her ay; "Saat aralığı ekle" ile yalnız belli saatlerde (örnekte hafta içi 14:00–17:00). Toplam adet sınırı: sınır dolunca kampanya biter.
- Misafirin QR menüsü: "Kampanyalı ürünler", çizili eski fiyat ve indirimli fiyat, kalan adet. Önce / sonra karşılaştırmasıyla.
- Garson tableti: kampanyalı fiyat; hediye kampanyasında "Kampanya: Türk Kahvesi bedava · Ekle". Hediye mutfağa kendiliğinden gitmez.
- Kasa ekranında hesap: her satırda uygulanan kampanya, hediyenin düşülen tutarı. Hesap fişinde "Kampanya indirimi" satırı yer alır.
- "Kampanya bitti" penceresi ve Satış ve Raporlar → Kampanyalar: satılan adet, ciro, verilen indirim, önceki haftalarla karşılaştırma.
- Ajanda ve rezervasyon → Rezervasyonlar: masa planı, misafir adı, kişi sayısı, telefon, not ve kapora.
- Ayar: Ajanda ve rezervasyon → Ayarlar → Rezervasyondan kaç dakika önce masa ayrılsın (varsayılan 30 dakika). Bu süreden itibaren masada "Rezerve" görünür ve masanın QR'ından yeni sipariş verilmez. Önce / sonra karşılaştırmasıyla.
- Misafir gelince "Geldi": adı masaya ve hesaba geçer, kapora hesaptan kendiliğinden düşülür.
- Etkinlikler (maç günü, konser): geçici masalar (QR'sız), masalara rezervasyon, Masalar ekranında ayrı bölüm; etkinliği kapatma ve Satış ve Raporlar → Rezervasyon raporu.

Bölümler
${lines.join('\n')}

Mola 30 gün ücretsiz denenebilir.
Web: https://molayazilim.com.tr
E-posta: destek@molayazilim.com.tr

ETİKETLER
Mola, Mola adisyon, kafe kampanya, happy hour, hediye ürün kampanyası, QR menü kampanya, rezervasyon programı, kapora, masa rezervasyonu, maç günü, etkinlik masası, adisyon programı, kafe yazılımı, Elazığ
`;
  writeFileSync(join(dirs.out, 'aciklama.txt'), text.replace(/\n/g, '\r\n'));
  console.log(lines.join('\n'), `\nToplam ${fmt(total)} (${total.toFixed(1)} sn)`);
}
/** The round badge of the thumbnail: a price tag (Kampanyalar). */
const tagBadge = `<svg viewBox="0 0 24 24" width="70" height="70" fill="none" stroke="${C.green}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="${C.green}"/></svg>`;
async function thumbnail(browser: Browser) {
  // The guest's Kahveler with the campaign prices, shot off camera by the recorder.
  await shootThumb(browser, introThumb({ tone: THUMB_TONES.kampanya, title: 'Kampanyalar ve<br>rezervasyon', shot: join(dirs.rec, 'kapak-telefon.png'), badge: tagBadge }));
}

await uret({ mp4: 'Kampanyalar ve rezervasyon.mp4', music: MUSIC, description, thumbnail, scenes,
  stillsAt: process.env.KARE_SIK ? (s => Array.from({ length: Math.ceil(s.duration / 2) }, (_, i) => Math.min(s.duration - .05, i * 2 + .6))) : undefined });
