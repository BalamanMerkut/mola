/*
 * YouTube 00 "Mola'yı 2 dakikada tanıyın" (the channel trailer and the first video of the introduction series): the 1920×1080
 * video, kapak.jpg and aciklama.txt from the recordings of scripts/sosyal/youtube-tanitim-kayit.ts, on the shared stage of
 * scripts/sosyal/youtube-sahne.ts. No voice-over: captions and the music of scripts/sosyal/muzik.py (soft breaks at the
 * chapters), -20 LUFS.
 *
 *   npx tsx scripts/sosyal/youtube-tanitim-kurgu.ts              everything (scenes → video → music → kapak.jpg, aciklama.txt)
 *   npx tsx scripts/sosyal/youtube-tanitim-kurgu.ts c1 e1        only these scenes again (then the video is joined again)
 *   npx tsx scripts/sosyal/youtube-tanitim-kurgu.ts --kare       a few stills per scene (layout check), no video
 *   npx tsx scripts/sosyal/youtube-tanitim-kurgu.ts --kapak      only the thumbnail and the description
 *   MUZIK=cesit-11 npx tsx scripts/sosyal/youtube-tanitim-kurgu.ts   another track (the scenes are kept: only the music and the
 *                                                                     join run again); default cesit-10 (Sol majör, 96 tempo)
 *   SOSYAL_CIKTI=<klasör> …                                     another output folder
 *
 * One quick tour of a café on Mola, for an owner who has never seen it: the guest's QR order, the kitchen display, the
 * waiter's tablet, the counter, the owner's report on the café computer and on the phone (İşletmemi yönet), then Mola Yardım
 * (in the app and on molayazilim.com.tr) and Destek. The owner's rules (18–19 Ekim): the logo opening, then the title; one
 * device at a time, at normal size, steady; no pointer: an ordinary tap is a soft ripple only; a red outline and a slight
 * 1.2× move at most once per beat, only where something small must be found (the Yardım button); a label at the top right
 * naming the device; short plain captions that say what happens; "30 gün ücretsiz deneme" on the closing card only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Browser } from '@playwright/test';
import sharp from 'sharp';
import { ROOT, W, chapters, cutLeads, dirs, endCard, fmt, focusKeys, frameFile, guestScene, around, introCard, introThumb, marks, meta, outlinesOf, shootThumb, staffScene, tapMarks, taps, uret, yer, type Cam, type CaptionsOf, type Layer, type Scene } from './youtube-sahne';

yer({ rec: join(ROOT, '.local', 'sosyal', 'youtube', 'tanitim', 'kayit'), work: join(ROOT, '.local', 'sosyal', 'youtube', 'tanitim', 'kurgu'),
  out: resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola YouTube', "00 Mola'yı 2 dakikada tanıyın")) });
const MUSIC = process.env.MUZIK ?? 'cesit-10';
const OWNER = 'İşletme sahibi';
type Opts = { taps?: string[]; gaps?: [number, number][]; toc?: string };
/** A café screen at normal size (the waiter's tablet, the kitchen display, the café computer's Mola window), its label at the top right. */
function device(name: string, clip: string, from: number, to: number, frame: 'tablet' | 'display' | 'win', tag: string, o: Opts, captions: CaptionsOf): Scene {
  return staffScene(name, clip, from, to, { frame, title: frame === 'win' ? 'Mola · İşletme yönetimi' : undefined, tag, taps: o.taps, gaps: o.gaps }, captions, o.toc);
}
/** A phone (the guest's, or the owner's), captions at its side; `gaps`: waits cut out (clip time), as on the other screens. */
function phone(name: string, clip: string, from: number, to: number, tag: string, side: 'guest' | 'business', o: Opts, captions: CaptionsOf): Scene {
  const names = o.taps ?? [], scene = { ...guestScene(name, clip, from, to, names, captions, o.toc), tag, side };
  if (!o.gaps) return scene;
  const { map, at, d } = cutLeads(clip, from, to, names, o.gaps), layer = scene.layers![0] as Extract<Layer, { kind: 'phone' }>;
  layer.map = map; layer.rings = tapMarks(clip, names, at, d).ripples;
  return { ...scene, duration: d, captions: captions(at, d) };
}
/** The site in a plain browser window (a 1280×800 page), the camera moving only for a control marked "!". */
function siteScene(name: string, clip: string, from: number, to: number, names: string[], title: string, captions: CaptionsOf): Scene {
  const size = meta(clip).size, vw = 1180, vh = vw * size.height / size.width;
  const { map, at, d } = cutLeads(clip, from, to, names), { ripples, focuses } = tapMarks(clip, names, at, d);
  const cam = focusKeys<Cam>({ x: 0, y: 0, w: size.width }, focuses, f => around(f.box, size.width / 1.2, size.width / size.height, size.width, size.height));
  return { name, duration: d, capPos: 'bottom', tag: 'İnternet sitesi', side: 'business', captions: captions(at, d),
    layers: [{ kind: 'screen', clip, w: vw, h: vh, keys: [{ t: 0, x: W / 2, y: 104 + (vh + 92) / 2 }], map, cam, rings: [...ripples, ...outlinesOf(focuses)], frame: 'browser',
      title: 'Mola', titles: [[0, 'molayazilim.com.tr', title]] }] };
}
const info = () => JSON.parse(readFileSync(join(dirs.rec, 'bilgi.json'), 'utf8')) as Record<string, string>;

function scenes(): Scene[] {
  const list: Scene[] = [];
  list.push({ name: 'a0-giris', duration: 8, card: introCard('Mola’yı 2 dakikada tanıyın', 'Kafe ve restoranlar için adisyon ve QR menü.'), toc: 'Giriş ve QR sipariş' });

  // ===== The guest orders from the table =====
  const Q = marks('q1-misafir'), Qt = taps('q1-misafir');
  list.push(phone('b1-misafir', 'q1-misafir', .2, Q.sent + 2.4, 'Misafir telefonu', 'guest', { taps: ['plus', 'add', 'plus2', 'add2', 'cart', 'send'],
    gaps: [[Q.menuReady + 2, Q.menuReady + 2.6], [Qt.add.tap! + .5, Qt.plus2.on + .15], [Qt.plus2.tap! + .6, Qt.add2.on + .15], [Qt.add2.tap! + .6, Qt.cart.on + .15], [Qt.cart.tap! + .9, Qt.send.on + .15]] }, at => [
    { from: .2, to: at(Q.menu) + .3, text: 'Misafir masadaki<br>QR kodu okutur.' },
    { from: at(Q.menu) + .4, to: at(Qt.plus.on), text: 'Menü fotoğraflarıyla<br>telefonda açılır.<br>Uygulama yüklenmez.' },
    { from: at(Qt.plus.on), to: at(Qt.send.on), text: 'Ürünleri seçip<br>sepete ekler.' },
    { from: at(Qt.send.on), to: at(Q.sent), text: '“Siparişi gönder”e<br>dokunur.' },
    { from: at(Q.sent), to: 99, text: 'Sipariş alındı.' },
  ]));

  // ===== The kitchen, the waiter, the counter =====
  const M = marks('m1-mutfak'), Mt = taps('m1-mutfak');
  list.push(device('c1-mutfak', 'm1-mutfak', M.ticket - 1.2, M.ready + 1.8, 'display', 'Mutfak ekranı', { taps: ['start', 'ready'], gaps: [[M.ticket + 2.4, Mt.start.on], [M.started - .1, Mt.ready.on + .15]], toc: 'Mutfak, garson ve kasa' }, at => [
    { from: .2, to: at(Mt.start.on), text: 'Sipariş mutfak ekranına düşer.' },
    { from: at(Mt.start.on), to: at(Mt.ready.on), text: 'Mutfak hazırlamaya başlar.' },
    { from: at(Mt.ready.on), to: 99, text: 'Bitince “Hazır” işaretlenir.' },
  ]));
  const T = marks('t1-garson'), Tt = taps('t1-garson');
  list.push(device('d1-garson', 't1-garson', T.ready + .6, T.served + 1.8, 'tablet', 'Garson tableti', { taps: ['nav', 'served'], gaps: [[T.count + 1.6, Tt.nav.on], [Tt.card.on + .4, Tt.served.on]] }, at => [
    { from: .2, to: at(Tt.nav.on), text: 'Hazır olan sipariş garson tabletine bildirilir.' },
    { from: at(Tt.nav.on), to: 99, text: 'Garson siparişi götürür, “Teslim edildi” ile işaretler.' },
  ]));
  const K = marks('k1-kasa'), Kt = taps('k1-kasa');
  list.push(device('e1-kasa', 'k1-kasa', 1, K.paid + 1.8, 'win', 'Kasa ekranı', { taps: ['table', 'pay', 'card', 'save'], gaps: [[Kt.bill.on + 1, Kt.pay.on + .15], [Kt.card.tap! + .6, Kt.save.on + .15]] }, at => [
    { from: .2, to: at(Kt.pay.on), text: 'Kasada masanın hesabı açılır.' },
    { from: at(Kt.pay.on), to: at(Kt.save.on), text: '“Ödeme al”: ödeme şekli seçilir.' },
    { from: at(Kt.save.on), to: 99, text: '“Ödemeyi kaydet”: hesap kapanır.' },
  ]));

  // ===== The owner: the report, the phone =====
  const R = marks('r1-rapor'), Rt = taps('r1-rapor');
  list.push(device('f1-rapor', 'r1-rapor', .2, R.end - .6, 'win', OWNER, { taps: ['nav'], gaps: [[Rt.sentence.on + 3, Rt.sentence.off! - .05]], toc: 'İşletme sahibi: rapor ve telefon' }, at => [
    { from: .2, to: at(Rt.sentence.on), text: 'İşletme sahibi “Satış ve Raporlar”a bakar.' },
    { from: at(Rt.sentence.on), to: at(Rt.grid.on), text: 'Günün satışı ve sipariş sayısı tek cümlede yazar.' },
    { from: at(Rt.grid.on), to: 99, text: 'Satış, giderler, elde kalan ve siparişler.' },
  ]));
  const P = marks('p1-telefon');
  list.push(phone('f2-telefon', 'p1-telefon', .2, P.end - .2, `${OWNER} <b>· Telefon</b>`, 'business', {}, at => [
    { from: .2, to: at(P.down) - 1.2, text: 'Aynı bilgiler<br>telefonda da görünür:<br>“İşletmemi yönet”.' },
    { from: at(P.down) - 1.2, to: 99, text: 'Kafede olmasa da<br>internet olan her yerden.' },
  ]));

  // ===== Mola Yardım, Destek =====
  const Y = marks('y1-yardim'), Yt = taps('y1-yardim');
  list.push(device('g1-yardim', 'y1-yardim', .2, Y.answer + 3.8, 'win', OWNER, { taps: ['!help', 'ask'], toc: 'Mola Yardım ve Destek' }, at => [
    { from: .2, to: at(Y.panel), text: 'Takılınca sağ üstteki “Yardım”a tıklanır.' },
    { from: at(Y.panel), to: at(Y.answer), text: 'Soru yazılır: “İnternet kesilirse ne olur?”' },
    { from: at(Y.answer), to: 99, text: 'Mola Yardım cevabı hemen verir.' },
  ]));
  const S = marks('w1-site');
  list.push(siteScene('g2-site', 'w1-site', 1.2, S.answer + 3.8, ['!fab', 'ask'], info().siteTitle ?? 'Mola', at => [
    { from: .2, to: at(S.answer), text: 'Mola Yardım molayazilim.com.tr’de de var.' },
    { from: at(S.answer), to: 99, text: 'Mola ekibine programdaki “Destek”ten ulaşılır.' },
  ]));
  const D = marks('d1-destek'), Dt = taps('d1-destek');
  list.push(device('g3-destek', 'd1-destek', .2, Dt.contact.on + 3, 'win', OWNER, { taps: ['nav'], gaps: [[Dt.tickets.on + 1.5, Dt.tickets.off! - .05], [Dt.new.on + 1.6, Dt.new.off! - .05]] }, at => [
    { from: .2, to: at(D.page), text: '“Destek”e tıklanır.' },
    { from: at(D.page), to: at(D.contact), text: '“Yeni talep” ile Mola ekibine yazılır; yanıt buraya gelir.' },
    { from: at(D.contact), to: 99, text: 'E-posta ve web adresimiz de burada yazar.' },
  ]));
  list.push({ name: 'h0-son', duration: 7.5, card: endCard });
  return list;
}

// ---------- Description and thumbnail ----------
function description(list: Scene[]) {
  const { lines, total } = chapters(list);
  const title = "Mola'yı 2 dakikada tanıyın: adisyon ve QR menü | Mola";
  if (title.length > 70) throw new Error(`Başlık ${title.length} karakter.`);
  const text = `BAŞLIK (${title.length} karakter)
${title}

AÇIKLAMA
Mola, kafe ve restoranlar için adisyon ve QR menü sistemidir. Bu videoda bir işletmenin günü Mola ile kısaca gösteriliyor. Görüntüler uygulamanın kendisinden, örnek bir işletmeyle kaydedildi.

Videoda:
- Misafir masadaki QR kodu telefonuyla okutur; menü fotoğraflarıyla açılır, sipariş telefondan gönderilir. Uygulama yüklenmez.
- Sipariş mutfak ekranına düşer; mutfak hazırlar ve “Hazır” işaretler.
- Garson tableti hazır siparişi bildirir; garson “Teslim edildi” ile işaretler.
- Kasada ödeme alınır, hesap kapanır.
- İşletme sahibi günün satışını Satış ve Raporlar’da, kafede değilken telefonundan İşletmemi yönet ile görür.
- Mola Yardım (programda sağ üstte ve molayazilim.com.tr’de) sorulara hazır cevap verir.
- Destek’ten Mola ekibine talep yazılır; yanıt aynı yere gelir.

Bölümler
${lines.join('\n')}

Mola 30 gün ücretsiz denenebilir.
Web: https://molayazilim.com.tr
E-posta: destek@molayazilim.com.tr

ETİKETLER
Mola, Mola adisyon, adisyon programı, kafe adisyon, restoran adisyon, QR menü, QR sipariş, kafe yazılımı, restoran yazılımı, mutfak ekranı, garson tableti, kasa programı, satış raporu, Elazığ
`;
  writeFileSync(join(dirs.out, 'aciklama.txt'), text.replace(/\n/g, '\r\n'));
  console.log(lines.join('\n'), `\nToplam ${fmt(total)} (${total.toFixed(1)} sn)`);
}
async function thumbnail(browser: Browser) {
  // The guest's menu on the phone, as in video 01's thumbnail (the Caffè Latte's card with its photo).
  const shot = join(dirs.work, 'kapak-telefon.png');
  await sharp(frameFile('q1-misafir', marks('q1-misafir').menuReady + 2.2)).png().toFile(shot);
  await shootThumb(browser, introThumb({ title: 'Mola’yı<br>2 dakikada<br>tanıyın', shot }));
}

await uret({ mp4: "Mola'yı 2 dakikada tanıyın.mp4", music: MUSIC, description, thumbnail, scenes,
  stillsAt: process.env.KARE_SIK ? (s => Array.from({ length: Math.ceil(s.duration / 2) }, (_, i) => Math.min(s.duration - .05, i * 2 + .6))) : undefined });
