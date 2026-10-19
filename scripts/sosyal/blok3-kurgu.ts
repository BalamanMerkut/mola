/*
 * Instagram blok 3 (posts 4–9 under the pinned brand row of blok 1): made from the recordings of scripts/sosyal/blok3-kayit.ts,
 * in the look of blok 2 (shared parts: scripts/sosyal/instagram-ortak.ts).
 *
 *   npx tsx scripts/sosyal/blok3-kurgu.ts                   everything (images, videos, grid preview, the delivery folder)
 *   npx tsx scripts/sosyal/blok3-kurgu.ts 5 7 stok          only these (5 7 9: images; stok rezervasyon yardim: videos;
 *                                                           izgara; teslim: the delivery folder from what is made)
 *   npx tsx scripts/sosyal/blok3-kurgu.ts --kare stok       a few stills of a video's stage (layout check), no video
 *
 * Made files go to .local/sosyal/blok3/cikti (SOSYAL_CIKTI: another folder); "teslim" lays them out for the owner in
 * Mola Instagram/Blok 3 (BLOK3_TESLIM: another folder), as Blok 2 is: "1. gün" (posts 9, 8, 7 in posting order) and
 * "2. gün" (6, 5, 4), each file with its "… - açıklama.txt" (the caption only), "Diğer (kapaklar ve hikâye için)" (covers and
 * 9:16 videos), _izgara-onizleme.jpg and "NASIL PAYLAŞILIR.txt".
 *
 * Images (5, 7, 9): green posts like blok 1 and 2; 7 is the real gün sonu e-mail of the demo café on a phone. Videos (4, 6, 8):
 * the owner's rules (19 Ekim): devices at normal size, steady, one at a time; a tap is a short soft ring; no pointer, no zoom.
 * Music: cesit-32 (stok), cesit-2 (rezervasyon), cesit-46 (yardım): three different keys and tempos, none used before.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { ROOT, SANS, SERIF, base, img, mark, meta } from './youtube-sahne';
import { C, CENTER, cutTimeline, grid, greenCss, hide, igYer, leads, phoneCss, render, ripplesOf, show, swap, video, wall, type Key, type Video } from './instagram-ortak';

const REC = join(ROOT, '.local', 'sosyal', 'blok3', 'kayit');
const WORK = join(ROOT, '.local', 'sosyal', 'blok3', 'kurgu');
const OUT = resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '.local', 'sosyal', 'blok3', 'cikti'));
const DELIVER = resolve(process.env.BLOK3_TESLIM ?? join(ROOT, '..', 'Mola Instagram', 'Blok 3'));
const BLOK1 = join(ROOT, '..', 'Mola Instagram', 'Blok 1');
const BLOK2 = join(ROOT, '..', 'Mola Instagram', 'Blok 2');
const SHOTS = join(REC, 'ekran');
const args = process.argv.slice(2), stills = args.includes('--kare'), only = args.filter(a => !a.startsWith('--'));
igYer({ rec: REC, work: WORK, out: OUT, music: join(ROOT, '..', 'Mola Müzik'), stills });
const wanted = (name: string) => !only.length || only.includes(name);
const info = existsSync(join(REC, 'bilgi.json')) ? JSON.parse(readFileSync(join(REC, 'bilgi.json'), 'utf8')) as Record<string, string> : {};

/** A lucide icon (the app's own icon set, node_modules/lucide-react) as an inline SVG. */
function icon(name: string, size: number, color: string, stroke = 1.8) {
  const src = readFileSync(join(ROOT, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons', `${name}.mjs`), 'utf8');
  const nodes = [...src.matchAll(/\[\s*"(\w+)",\s*\{([^}]*)\}\s*\]/g)].map(([, tag, attrs]) => `<${tag} ${[...attrs.matchAll(/(\w+): "([^"]*)"/g)].filter(([, k]) => k !== 'key').map(([, k, v]) => `${k}="${v}"`).join(' ')}/>`);
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${nodes.join('')}</svg>`;
}
const foot = `.foot{position:absolute;left:0;right:0;bottom:56px;display:flex;align-items:center;justify-content:center;gap:16px;font:26px/1 ${SANS};color:rgba(243,235,221,.8)}
  .foot svg{border-radius:12px;box-shadow:0 0 0 2px rgba(243,235,221,.35)}`;

// ---------- Images ----------
/** Post 5: what keeps working on the café's own network when the internet is down (site: Sözlerimiz; Mola Yardım's answer). */
function internetHtml() {
  const tile = (ic: string, title: string, line: string) => `<div class="tile"><span>${icon(ic, 58, C.green)}</span><b>${title}</b><small>${line}</small></div>`;
  return base(1080, 1350, `
  <div class="eyebrow">İNTERNET KESİLİRSE</div>
  <h1 class="serif">İnternet kesilse de <em>çalışır.</em></h1>
  <p class="sub">Mola kafenizin kendi bilgisayarında çalışır.<br>Modem ve Wi-Fi açık oldukça kafenin ağındaki<br>cihazlar çalışmaya devam eder.</p>
  <div class="tiles">
    ${tile('monitor', 'Kasa', 'Hesap kapanır')}
    ${tile('smartphone', 'Garson', 'Sipariş alınır')}
    ${tile('chef-hat', 'Mutfak', 'Sipariş mutfağa düşer')}
  </div>
  <div class="note">${icon('wifi-off', 46, '#efc2aa', 2)}<p>İnternet yokken müşteri QR’dan sipariş veremez; siparişi garson alır. Telefondan uzaktan rapor, internet gelince devam eder.</p></div>
  <div class="foot">${mark(44)}<span>molayazilim.com.tr</span></div>`, `
  ${greenCss}${foot}
  .sub{line-height:1.4}
  .tiles{position:absolute;left:70px;right:70px;top:500px;display:grid;grid-template-columns:repeat(3,1fr);gap:26px}
  .tile{background:${C.paper};border-radius:34px;padding:44px 18px 40px;display:flex;flex-direction:column;align-items:center;gap:16px;box-shadow:0 50px 90px -40px rgba(0,0,0,.6)}
  .tile span{width:110px;height:110px;border-radius:30px;background:${C.green100};display:grid;place-items:center}
  .tile b{font:400 50px/1 ${SERIF};color:${C.green900};margin-top:6px}
  .tile small{font:600 27px/1.25 ${SANS};color:${C.muted}}
  .note{position:absolute;left:70px;right:70px;top:930px;display:flex;align-items:center;gap:28px;text-align:left;padding:34px 40px;border-radius:30px;border:2px solid rgba(243,235,221,.28);background:rgba(0,0,0,.12)}
  .note svg{flex:none}
  .note p{font:30px/1.38 ${SANS};color:rgba(243,235,221,.92)}`);
}
/** Post 7: the demo café's real gün sonu e-mail (its own HTML, shot on a phone by the recorder). */
function dayEndHtml() {
  const sw = 386;
  return base(1080, 1350, `
  <div class="eyebrow">GÜN SONU</div>
  <h1 class="serif">Gün sonu <em>cebinizde.</em></h1>
  <p class="sub">Gün sonu kapanışından sonra rapor<br>e-postanıza gelir, PDF ekiyle.</p>
  <div class="phone" style="left:${540 - sw / 2 - Math.round(sw * .03)}px;top:382px"><div class="screen"><img src="${img(join(SHOTS, 'gun-sonu-eposta.png'))}"></div></div>`, `
  ${greenCss}${phoneCss(sw)}
  .sub{line-height:1.35}`);
}
/** Post 9: Elazığ, setup and support on site (only what the site says: index.html Sözlerimiz, iletisim.html "Kurulum nasıl oluyor?"). */
function elazigHtml() {
  const row = (t: string) => `<li>${icon('check', 40, C.green, 2.4)}<span>${t}</span></li>`;
  return base(1080, 1350, `
  <div class="eyebrow">ELAZIĞ</div>
  <h1 class="serif">Elazığ’da yerinde<br><em>kurulum ve destek.</em></h1>
  <div class="card">
    <h2 class="serif">Kurulum ve ilk eğitim işletmenizde</h2>
    <ul>
      ${row('Mola’yı kasadaki bilgisayara kurarız.')}
      ${row('Menünüzü birlikte gireriz.')}
      ${row('Masa QR kodlarını hazırlar, garson telefonlarını ve mutfak tabletini bağlarız.')}
      ${row('Çalışanlarınıza kısa bir eğitim veririz.')}
    </ul>
  </div>
  <p class="after">${icon('headset', 44, '#efc2aa', 1.9)}<span>Sonrasında telefon, WhatsApp ve<br>izin verirseniz uzaktan destek.</span></p>
  <div class="foot">${mark(44)}<span>Merkut Studios · Elazığ · molayazilim.com.tr</span></div>`, `
  ${greenCss}${foot}
  h1{font-size:78px}
  .card{position:absolute;left:70px;right:70px;top:400px;background:${C.paper};border-radius:34px;padding:50px 56px 40px;text-align:left;box-shadow:0 50px 90px -40px rgba(0,0,0,.6)}
  .card h2{font-weight:400;font-size:46px;line-height:1.1;color:${C.green900};margin-bottom:22px}
  .card ul{list-style:none}
  .card li{display:flex;align-items:flex-start;gap:22px;padding:20px 0;border-top:2px solid ${C.line};font:32px/1.3 ${SANS};color:${C.ink}}
  .card li svg{flex:none;margin-top:-2px}
  .after{position:absolute;left:0;right:0;top:1080px;display:flex;align-items:center;justify-content:center;gap:24px;text-align:left;font:32px/1.35 ${SANS};color:rgba(243,235,221,.92)}`);
}

// ---------- The three videos ----------
/** One screen fades into the next in place (the same device a few hours later). */
function crossfade(t: number, d = .5): { out: Key[]; in: Key[] } {
  return { out: [{ t, ...show(CENTER.x, CENTER.y) }, { t: t + d, ...show(CENTER.x, CENTER.y), o: 0 }], in: [{ t, ...show(CENTER.x, CENTER.y), o: 0 }, { t: t + d, ...show(CENTER.x, CENTER.y) }] };
}
const optTap = (w: ReturnType<typeof wall>, clip: string, name: string) => (meta(clip).taps ?? []).some(t => t.name === name) ? w.tap(clip, name) : undefined;
const amount = (s: string | undefined) => /(\d+(?:,\d+)?\s?(?:L|ml|kg|g))/.exec(s ?? '')?.[1]?.replace(/\s/, ' ');

/** Post 4: Caffè Latte's recipe, Süt on the shelf; the waiter sends 2 lattes; Süt has gone down: "Az kaldı", the notification. */
function stok(): Video {
  const O = 'stok-sahip', T = 'stok-garson', w = wall(O);
  const recipe = w.tap(O, 'recipe'), items = w.tap(O, 'items'), before = w.tap(O, 'milkBefore'), send = w.tap(T, 'send'), again = w.tap(O, 'again'), afterLook = w.tap(O, 'milkAfter'), toast = optTap(w, O, 'toast');
  const after = w.mk(O, 'after'), back = w.mk(O, 'back') + .3, tEnd = w.mk(T, 'sent') + 1.4;
  const pieces = [{ hold: .5, at: .4 }, { from: .4, to: recipe.off! - .4 }, { from: items.on, to: before.off! - .5 }, { from: send.on, to: tEnd }, { from: back, to: afterLook.off! - .4 },
    ...(toast ? [{ from: toast.on, to: toast.on + 2.4 }] : [])];
  const { map, at, d } = cutTimeline(pieces, [...leads([items, send, again]), [again.tap! + .6, after - .1]]);
  const s1 = swap(at(send.on) - .3), s2 = swap(at(back) - .3);
  const milk0 = amount(info.milkBefore) ?? '4,3 L', milk1 = amount(info.milkAfter) ?? '3,9 L';
  return { name: 'stok', file: '04-stok', seed: 32, track: 'Instagram Blok 3 - 04 Stok', duration: d, map,
    cover: { t: at(after) + 1.4, title: 'Stok <em>kendiliğinden</em> düşer', sub: 'Satılan ürünün malzemeleri reçetesinden düşer' },
    captions: [
      { from: 0, to: at(items.tap!) - .1, text: 'Caffè Latte’nin reçetesi:<br><em>espresso ve süt</em>' },
      { from: at(items.tap!), to: at(send.on) - .4, text: `Rafta süt: <em>${milk0}</em><br>Uyarı sınırı: 4 L` },
      { from: at(send.on) - .2, to: at(back) - .4, text: 'Garson 2 Caffè Latte<br>gönderir' },
      { from: at(back) - .2, to: at(after) - .1, text: 'Malzemeler <em>kendiliğinden</em><br>düşer' },
      { from: at(after), to: toast ? at(toast.on) - .1 : d + 1, text: `Süt: <em>${milk1}</em><br>sınırın altında: “Az kaldı”` },
      ...(toast ? [{ from: at(toast.on), to: d + 1, text: 'Size bildirim gelir:<br><em>Süt azaldı</em>' }] : []),
    ],
    devices: [
      { id: 'o', clip: O, kind: 'tablet', label: 'İşletme sahibi', keys: [{ t: 0, ...show(CENTER.x, CENTER.y) }, ...s1.out, { t: at(back) - .3, ...hide(CENTER.x + 160, CENTER.y) }, { t: at(back) + .3, ...show(CENTER.x, CENTER.y) }],
        ripples: ripplesOf([items, again], at) },
      { id: 't', clip: T, kind: 'tablet', label: 'Garson tableti', keys: [{ t: 0, ...hide(CENTER.x + 160, CENTER.y) }, ...s1.in, ...s2.out], ripples: ripplesOf([send], at) },
    ] };
}
/** Post 6: a reservation in Ajanda ve rezervasyon, the table on Masalar; later the guest arrives: "Geldi". */
function rezervasyon(): Video {
  const A = 'rez-ajanda', G = 'rez-geldi', w = wall(A);
  const at3 = ['nav', 'time', 'table', 'name', 'people', 'save', 'masalar'].map(n => w.tap(A, n)), [navT, time, table, name, people, save, masalar] = at3;
  const gt = ['open', 'came'].map(n => w.tap(G, n)), [open, came] = gt;
  const tile = w.tap(A, 'tile'), card = w.tap(A, 'card'), cardAfter = w.tap(G, 'cardAfter');
  const aEnd = card.on + 2.2, gFrom = open.on - .4, gEnd = cardAfter.on + 2.4;
  const trims: [number, number][] = [[navT.tap! + .9, time.on], [time.tap! + 1.4, table.on], [table.tap! + .7, w.mk(A, 'form') - .1], [people.tap! + 1.2, save.on], [save.tap! + .5, w.mk(A, 'saved') - .1],
    [tile.on + 1.1, masalar.on], [masalar.tap! + .8, card.on - .1], [open.tap! + .8, came.on]];
  const { map, at, d } = cutTimeline([{ hold: .4, at: .4 }, { from: .4, to: aEnd }, { from: gFrom, to: gEnd }], [...leads([...at3, ...gt]), ...trims]);
  const x = crossfade(at(aEnd) - .25);
  return { name: 'rezervasyon', file: '06-rezervasyon', seed: 2, track: 'Instagram Blok 3 - 06 Rezervasyon', duration: d, map,
    cover: { t: at(card.on) + 1.2, title: 'Masa <em>rezervasyonu</em>', sub: 'Kaydedin; masa ayrılır, müşteri gelince açılır' },
    captions: [
      { from: 0, to: at(time.tap!) - .1, text: 'Ajanda ve rezervasyon' },
      { from: at(time.tap!), to: at(table.tap!) - .1, text: 'Saati yazın: <em>19:15</em>' },
      { from: at(table.tap!), to: at(name.tap!) - .1, text: 'Masayı seçin' },
      { from: at(name.tap!), to: at(save.tap!) - .1, text: 'Ad ve kişi sayısı' },
      { from: at(save.tap!), to: at(masalar.tap!) - .1, text: 'Kaydedin; masa<br><em>ayrılır</em>' },
      { from: at(masalar.tap!), to: at(aEnd) - .25, text: 'Masalar’da<br><em>rezerve</em> görünür' },
      { from: at(aEnd) - .1, to: at(came.tap!) - .1, text: 'Müşteri gelince<br>masaya dokunun' },
      { from: at(came.tap!), to: d + 1, text: '<em>“Geldi”</em>:<br>masa açılır' },
    ],
    devices: [
      { id: 'a', clip: A, kind: 'tablet', label: 'İşletme sahibi', keys: [{ t: 0, ...show(CENTER.x, CENTER.y) }, ...x.out], ripples: ripplesOf(at3, at) },
      { id: 'g', clip: G, kind: 'tablet', label: 'Akşam, 19:12', keys: [{ t: 0, ...show(CENTER.x, CENTER.y), o: 0 }, ...x.in], ripples: ripplesOf(gt, at) },
    ] };
}
/** Post 8: Mola Yardım on the owner's phone: a question in plain words, its answer with the video link; a misspelt one. */
function yardim(): Video {
  const Y = 'yardim', w = wall(Y);
  const yt = ['help', 'ask', 'ask2', 'choice'].map(n => w.tap(Y, n)), [help, ask, ask2, choice] = yt;
  const answer = w.tap(Y, 'answer'), guess = w.tap(Y, 'guess'), answer2 = w.tap(Y, 'answer2');
  const end = answer2.on + 2.8;
  const trims: [number, number][] = [[help.tap! + .9, ask.on], [answer.on + 3.0, ask2.on], [guess.on - 1.0, guess.on - .2], [guess.on + 2.6, choice.on], [choice.tap! + .8, answer2.on]];
  const { map, at, d } = cutTimeline([{ hold: .4, at: .4 }, { from: .4, to: end }], [...leads(yt), ...trims]);
  return { name: 'yardim', file: '08-mola-yardim', seed: 46, track: 'Instagram Blok 3 - 08 Mola Yardım', duration: d, map,
    cover: { t: at(answer.on) + 1.5, title: 'Aklınıza takılanı<br><em>Mola Yardım</em>’a sorun', sub: 'Uygulamanın içinde, kendi cümlenizle' },
    captions: [
      { from: 0, to: at(ask.tap!) - .1, text: '<em>Mola Yardım</em><br>uygulamanın içinde' },
      { from: at(ask.tap!), to: at(answer.on) - .1, text: 'Kendi cümlenizle<br>yazın' },
      { from: at(answer.on), to: at(ask2.tap!) - .1, text: 'Cevap ve<br><em>videoda</em> anlatılan yer' },
      { from: at(ask2.tap!), to: at(guess.on) - .1, text: 'Yanlış yazsanız da…' },
      { from: at(guess.on), to: at(choice.tap!) - .1, text: '<em>Bunu mu demek</em><br><em>istediniz?</em>' },
      { from: at(choice.tap!), to: d + 1, text: 'Doğru cevap<br>bir dokunuşta' },
    ],
    devices: [{ id: 'y', clip: Y, kind: 'phone', label: 'İşletme sahibi', keys: [{ t: 0, ...show(CENTER.x, CENTER.y) }], ripples: ripplesOf(yt, at) }] };
}

// ---------- The delivery folder (as Blok 2: posting order, captions beside) ----------
const TAGS = {
  9: '#elazığ #elazig #elazığkafe #elazığrestoran #adisyon #adisyonprogramı #kafeişletmesi',
  8: '#elazığ #elazığkafe #elazığrestoran #adisyon #adisyonprogramı #kafeişletmesi #restoranyönetimi',
  7: '#elazığ #elazig #elazığkafe #günsonu #raporlama #adisyon #kafeişletmesi',
  6: '#elazığ #elazığkafe #elazığrestoran #rezervasyon #adisyon #kafeişletmesi #restoranyönetimi',
  5: '#elazığ #elazig #elazığkafe #adisyon #adisyonprogramı #kafeişletmesi #restoranyönetimi',
  4: '#elazığ #elazığkafe #elazığrestoran #stoktakibi #reçete #adisyon #kafeişletmesi',
};
const POSTS: { n: 4 | 5 | 6 | 7 | 8 | 9; day: 1 | 2; order: number; name: string; src: string; video?: boolean; text: string }[] = [
  { n: 9, day: 1, order: 1, name: 'Elazığ’da yerinde kurulum', src: '09-elazig-kurulum.jpg', text:
    'Elazığ’da yerinde kurulum ve destek. 📍\nMola’yı kasadaki bilgisayarınıza kurar, menünüzü birlikte girer, masa QR kodlarını hazırlar, garson telefonlarını ve mutfak tabletini bağlarız. Ardından çalışanlarınıza kısa bir eğitim veririz.\nSonrasında telefon, WhatsApp ve izin verirseniz uzaktan destek.' },
  { n: 8, day: 1, order: 2, name: 'Mola Yardım', src: '08-mola-yardim-4x5.mp4', video: true, text:
    'Aklınıza takılanı Mola Yardım’a sorun. 💬\nUygulamanın içindeki Mola Yardım’a sorunuzu kendi cümlenizle yazarsınız, cevap gelir. Konu bir Mola videosunda anlatılıyorsa videodaki yeri de gösterilir.\nYazım hatası olsa da yakın soruları “Bunu mu demek istediniz?” diye önerir.' },
  { n: 7, day: 1, order: 3, name: 'Gün sonu raporu', src: '07-gun-sonu.jpg', text:
    'Gün sonu cebinizde. 📩\nGün sonu kapanışından sonra günün raporu e-postanıza gelir: tahsilat, nakit ve kart, en çok kazandıranlar, kasa farkı. PDF ekini muhasebecinize de iletebilirsiniz.\nRapor kafenizin bilgisayarında hazırlanır, kendi e-posta hesabınızdan gönderilir. Görsel, örnek işletmemizin verisinden.' },
  { n: 6, day: 2, order: 1, name: 'Rezervasyon', src: '06-rezervasyon-4x5.mp4', video: true, text:
    'Masa rezervasyonu. 📅\nAjanda ve rezervasyon’da saati ve masayı seçip müşterinin adını ve kişi sayısını yazarsınız. Saati yaklaşınca masa, Masalar’da “Rezerve” görünür.\nMüşteri gelince “Geldi” dersiniz, masa açılır.' },
  { n: 5, day: 2, order: 2, name: 'İnternet kesilse de çalışır', src: '05-internet.jpg', text:
    'İnternet kesilse de çalışır. 📶\nMola kafenizin kendi bilgisayarında çalışır. Modem ve Wi-Fi açık oldukça kasa, garson ve mutfak çalışmaya devam eder: sipariş alınır, mutfağa düşer, hesap kapanır.\nİnternet yokken müşteri QR’dan sipariş veremez; siparişi garson alır.' },
  { n: 4, day: 2, order: 3, name: 'Stok kendiliğinden düşer', src: '04-stok-4x5.mp4', video: true, text:
    'Stok kendiliğinden düşer. 📦\nÜrünün reçetesini bir kez yazarsınız; her satışta malzemeleri stoktan kendiliğinden düşer.\nBir malzeme uyarı sınırının altına inince “Az kaldı” görünür, size de bildirim gelir.' },
];
function deliver() {
  const days = { 1: join(DELIVER, '1. gün'), 2: join(DELIVER, '2. gün') }, other = join(DELIVER, 'Diğer (kapaklar ve hikâye için)');
  for (const dir of [...Object.values(days), other]) mkdirSync(dir, { recursive: true });
  for (const p of POSTS) {
    const base = `${p.order}. ${p.name}${p.video ? ' (video)' : ''}`, ext = p.video ? '.mp4' : '.jpg';
    copyFileSync(join(OUT, p.src), join(days[p.day], base + ext));
    // As Blok 2's: UTF-8 without BOM, Windows line ends.
    writeFileSync(join(days[p.day], `${base} - açıklama.txt`), `${p.text}\n👉 molayazilim.com.tr\n\n${TAGS[p.n]}\n`.replace(/\n/g, '\r\n'));
  }
  for (const f of ['04-stok', '06-rezervasyon', '08-mola-yardim']) for (const x of [`${f}-kapak.jpg`, `${f}.mp4`]) copyFileSync(join(OUT, x), join(other, x));
  copyFileSync(join(OUT, '_izgara-onizleme.jpg'), join(DELIVER, '_izgara-onizleme.jpg'));
  const how = readFileSync(join(BLOK2, 'NASIL PAYLAŞILIR.txt'), 'utf8').replaceAll('Blok 2', 'Blok 3');
  writeFileSync(join(DELIVER, 'NASIL PAYLAŞILIR.txt'), how);
  console.log(`  teslim: ${DELIVER}`);
}

async function main() {
  const browser = await chromium.launch({ channel: process.env.SOSYAL_TARAYICI ?? 'chrome' });
  try {
    if (!stills) {
      if (wanted('5')) await render(browser, internetHtml(), '05-internet');
      if (wanted('7')) await render(browser, dayEndHtml(), '07-gun-sonu');
      if (wanted('9')) await render(browser, elazigHtml(), '09-elazig-kurulum');
    }
    for (const [name, make] of [['stok', stok], ['rezervasyon', rezervasyon], ['yardim', yardim]] as const) if (wanted(name)) await video(browser, make());
    if (!stills && wanted('izgara')) await grid([join(BLOK1, '01-marka-logo.jpg'), join(BLOK1, '02-marka-mola.jpg'), join(BLOK1, '03-marka-slogan.jpg'),
      join(OUT, '04-stok-kapak.jpg'), join(OUT, '05-internet.jpg'), join(OUT, '06-rezervasyon-kapak.jpg'),
      join(OUT, '07-gun-sonu.jpg'), join(OUT, '08-mola-yardim-kapak.jpg'), join(OUT, '09-elazig-kurulum.jpg')], join(OUT, '_izgara-onizleme.jpg'));
    if (!stills && wanted('teslim')) deliver();
  } finally { await browser.close(); }
}
await main();
