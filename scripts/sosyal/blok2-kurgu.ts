/*
 * Instagram blok 2 (posts 4–9 under the pinned brand row of blok 1): made from the recordings of scripts/sosyal/blok2-kayit.ts.
 *
 *   npx tsx scripts/sosyal/blok2-kurgu.ts                   everything (images, videos, grid preview)
 *   npx tsx scripts/sosyal/blok2-kurgu.ts 5 7 mutfak        only these (5 7 9: images; mutfak kampanya uzak: videos; izgara)
 *   npx tsx scripts/sosyal/blok2-kurgu.ts --kare mutfak     a few stills of a video's stage (layout check), no video
 *   SOSYAL_CIKTI=<klasör> …                                 another output folder
 *
 * Images: HTML in Chrome (site colours, Georgia + Segoe UI, as blok 1) → 1080×1350 JPEG; the screens in them are real
 * screenshots of the demo café. Videos (owner's rules, 19 Ekim): a 1080×1920 stage drawn for every frame at 30 fps from the
 * recordings (devices at normal size, steady, one at a time; an ordinary tap shows only a short soft ring; no pointer, no zoom),
 * captions say only what happens. Everything important stays in the central 1080×1350, which is the 4:5 post:
 *   <n>-4x5.mp4   the cover (<n>-kapak.jpg) for 1 s, a 0.35 s fade into the stage's 4:5 crop (Meta uses the first frame as cover)
 *   <n>.mp4       the whole 9:16 stage (stories)
 * H.264 High, yuv420p BT.709, 30 fps, AAC 48 kHz stereo; music: scripts/sosyal/muzik.py cesit-N (a different track for each
 * video), about −20 LUFS, its mp3 also in Mola Müzik.
 */
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { ROOT, SANS, base, img, mark } from './youtube-sahne';
import { C, CENTER, cutTimeline, grid as gridOf, greenCss, hide, igYer, leads, phoneCss, render, ripplesOf, show, swap, video, wall, type Video } from './instagram-ortak';

const REC = join(ROOT, '.local', 'sosyal', 'blok2', 'kayit');
const WORK = join(ROOT, '.local', 'sosyal', 'blok2', 'kurgu');
const OUT = resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola Instagram', 'Blok 2'));
const BLOK1 = join(ROOT, '..', 'Mola Instagram', 'Blok 1');
const SHOTS = join(REC, 'ekran');
const args = process.argv.slice(2), stills = args.includes('--kare'), only = args.filter(a => !a.startsWith('--'));
igYer({ rec: REC, work: WORK, out: OUT, music: join(ROOT, '..', 'Mola Müzik'), stills });
const wanted = (name: string) => !only.length || only.includes(name);

/** Post 5: the guest's Türk Kahvesi on the QR menu (a real phone screenshot). */
function productHtml() {
  const sw = 432;
  return base(1080, 1350, `
  <div class="eyebrow">QR MENÜ</div>
  <h1 class="serif">Her ürün <em>fotoğrafıyla.</em></h1>
  <p class="sub">Müşteri görür, seçeneğini seçer, sepete ekler.</p>
  <div class="phone" style="left:${540 - sw / 2 - Math.round(sw * .03)}px;top:350px"><div class="screen"><img src="${img(join(SHOTS, 'turk-kahvesi.png'))}"></div></div>`, `
  ${greenCss}${phoneCss(sw)}`);
}
/** Post 7: the same floor on the counter's tablet and the waiter's phone (real screenshots). */
function floorHtml() {
  const vw = 860, vh = Math.round(vw * 820 / 1180), sw = 292;
  return base(1080, 1350, `
  <div class="eyebrow">MASALAR</div>
  <h1 class="serif">Salonunuz <em>bir bakışta.</em></h1>
  <p class="sub">Açık, boş, servise hazır: her masa kendi renginde.</p>
  <div class="tab"><div class="screen"><img src="${img(join(SHOTS, 'masalar-tablet.png'))}"></div></div>
  <div class="phone" style="right:34px;top:630px"><div class="screen"><img src="${img(join(SHOTS, 'masalar-telefon.png'))}"></div></div>`, `
  ${greenCss}${phoneCss(sw)}
  .tab{position:absolute;left:34px;top:460px;padding:18px;border-radius:34px;background:#1c2721;box-shadow:0 60px 110px -40px rgba(0,0,0,.6),inset 0 0 0 2px #3a4a41}
  .tab .screen{width:${vw}px;height:${vh}px;border-radius:12px;overflow:hidden;background:${C.paper}}.tab img{display:block;width:100%;height:100%}`);
}
/** Post 9: the QR share of the last 30 days (Satış ve Raporlar → Personel), a real screenshot of the report's card. */
function qrShareHtml(w: number, h: number) {
  const cw = 900, ch = Math.round(cw * h / w);
  return base(1080, 1350, `
  <div class="eyebrow">RAPORLAR</div>
  <h1 class="serif">Siparişlerinizin ne kadarını müşterileriniz <em>QR ile</em> veriyor?</h1>
  <div class="card"><img src="${img(join(WORK, 'qr-payi-kirp.png'))}" style="width:${cw}px;height:${ch}px"></div>
  <div class="big serif">30 günde görün.</div>
  <div class="foot">${mark(44)}<span>Satış ve Raporlar → Personel</span></div>`, `
  ${greenCss}
  h1{font-size:68px;line-height:1.14;padding:0 70px}
  .card{position:absolute;left:${540 - cw / 2 - 14}px;top:${Math.round(725 - ch / 2)}px;padding:14px;background:${C.paper};border-radius:34px;box-shadow:0 50px 90px -40px rgba(0,0,0,.6)}
  .card img{display:block;border-radius:22px}
  .big{position:absolute;left:0;right:0;top:${Math.round(725 + ch / 2) + 64}px;font-size:86px;line-height:1;color:${C.cup};font-style:italic}
  .foot{position:absolute;left:0;right:0;bottom:56px;display:flex;align-items:center;justify-content:center;gap:16px;font:26px/1 ${SANS};color:rgba(243,235,221,.8)}
  .foot svg{border-radius:12px;box-shadow:0 0 0 2px rgba(243,235,221,.35)}`);
}

// ---------- The three videos ----------
/** Post 4: the waiter's tablet sends, the kitchen display gets it, starts, marks it ready; the tablet: "Servise hazır". */
function mutfak(): Video {
  const T = 'mutfak-tablet', K = 'mutfak-ekran', w = wall(T);
  const send = w.tap(T, 'send'), start = w.tap(K, 'start'), ready = w.tap(K, 'ready'), nav = w.tap(T, 'readyNav');
  const toB = send.tap! + .8, toC = w.mk(K, 'readyDone') + 1.8, end = w.mk(T, 'readyList') + 3.0;
  const { map, at, d } = cutTimeline([{ hold: 1.2, at: .4 }, { from: .4, to: end }], leads([send, start, ready, nav]));
  const sB = swap(at(toB)), sC = swap(at(toC));
  return { name: 'mutfak', file: '04-mutfak', seed: 21, track: 'Instagram Blok 2 - 04 Mutfak', duration: d, map,
    cover: { t: at(w.mk(K, 'ticket')) + 1.4, title: 'Sipariş <em>mutfağa</em> düşer', sub: 'Garsonun tabletinden mutfak ekranına' },
    captions: [
      { from: 0, to: at(toB), text: 'Garson siparişi<br>tabletten gönderir' },
      { from: at(toB) + .1, to: at(start.tap!) - .1, text: 'Sipariş <em>mutfak ekranına</em><br>anında düşer' },
      { from: at(start.tap!), to: at(ready.tap!) - .1, text: 'Mutfak hazırlamaya<br>başlar' },
      { from: at(ready.tap!), to: at(toC) + .2, text: 'Hazır olunca<br><em>tek dokunuş</em>' },
      { from: at(toC) + .3, to: d + 1, text: 'Garson tabletinde<br><em>servise hazır</em> görür' },
    ],
    devices: [
      { id: 't', clip: T, kind: 'tablet', label: 'Garson tableti', keys: [{ t: 0, ...show(CENTER.x, CENTER.y) }, ...sB.out, { t: at(toC), ...hide(CENTER.x + 160, CENTER.y) }, { t: at(toC) + .6, ...show(CENTER.x, CENTER.y) }],
        ripples: ripplesOf([send, nav], at) },
      { id: 'k', clip: K, kind: 'display', label: 'Mutfak ekranı', keys: [{ t: 0, ...hide(CENTER.x + 160, CENTER.y) }, ...sB.in, ...sC.out], ripples: ripplesOf([start, ready], at) },
    ] };
}
/** Post 6: the owner's phone makes "2 al 1 öde" for Caffè Latte; the guest's phone: the badge, two lattes, the discount. */
function kampanya(): Video {
  const O = 'kampanya-sahip', G = 'kampanya-musteri', w = wall(O);
  const names = (clip: string, list: string[]) => list.map(n => w.tap(clip, n));
  const ot = names(O, ['add', 'pick', 'product', 'done', 'save']), kind = w.tap(O, 'kind'), gt = names(G, ['kahveler', 'product', 'more', 'add', 'cart']);
  const [add, pick, product, done, save] = ot, [kahveler, gProduct, more, gAdd, cart] = gt;
  const oEnd = w.mk(O, 'card') + .6, gFrom = w.start(G) + .5, gEnd = w.mk(G, 'basket') + 2.0;
  // Waits trimmed (only still moments: nothing moves on the screen there), so the post stays about 20 s.
  const named = w.mk(O, 'named'), grid = w.mk(G, 'grid');
  const trims: [number, number][] = [[w.start(O) + .4 + .6, add.on], [add.tap! + .8, w.mk(O, 'form')], [kind.tap! + 1.1, pick.on], [pick.tap! + .9, product.on], [product.tap! + .6, done.on],
    [named + .1, save.on + .1],
    [grid + 1.2, gProduct.on], [gProduct.tap! + .8, more.on], [more.tap! + .4, gAdd.on], [gAdd.tap! + .5, cart.on]];
  const { map, at, d } = cutTimeline([{ hold: .4, at: .4 }, { from: .4, to: oEnd }, { from: gFrom, to: gEnd }], [...leads([...ot, ...gt]), ...trims]);
  const s = swap(at(oEnd) - .3);
  return { name: 'kampanya', file: '06-kampanya', seed: 18, track: 'Instagram Blok 2 - 06 Kampanya', duration: d, map,
    cover: { t: at(w.mk(G, 'basket')) + 1.2, title: '<em>2 al 1 öde</em> kampanyası', sub: 'Kurun; menüde ve sepette hemen görünsün' },
    captions: [
      { from: 0, to: at(kind.tap!) - .1, text: 'Kampanyalar →<br>“Kampanya ekle”' },
      { from: at(kind.tap!), to: at(pick.tap!) - .1, text: 'Türü: <em>X al Y öde</em><br>2 al, 1 öde' },
      { from: at(pick.tap!), to: at(save.tap!) - .1, text: 'Ürünü menüden seçin' },
      { from: at(save.tap!), to: at(oEnd) - .3, text: 'Kaydedin;<br>kampanya <em>başlar</em>' },
      { from: at(oEnd) - .2, to: at(cart.tap!) - .1, text: 'Müşteri menüde<br><em>2 al 1 öde</em>yi görür' },
      { from: at(cart.tap!), to: d + 1, text: 'İndirim sepete<br><em>kendiliğinden</em> düşer' },
    ],
    devices: [
      { id: 'o', clip: O, kind: 'phone', label: 'İşletme sahibi', keys: [{ t: 0, ...show(CENTER.x, CENTER.y) }, ...s.out], ripples: ripplesOf([add, kind, ...ot.slice(1)], at) },
      { id: 'g', clip: G, kind: 'phone', label: 'Müşteri', keys: [{ t: 0, ...hide(CENTER.x + 160, CENTER.y) }, ...s.in], ripples: ripplesOf([kahveler, ...gt.slice(1)], at) },
    ] };
}
/** Post 8: İşletmemi yönet on the owner's phone: today's sales, then a price changed; the guest's menu shows it. */
function uzak(): Video {
  const O = 'uzak-telefon', G = 'uzak-musteri', w = wall(O);
  const ot = ['yonet', 'more', 'menu', 'edit', 'price', 'save'].map(n => w.tap(O, n)), gt = [w.tap(G, 'tatlilar')];
  const [yonet, more, menu, edit, price, save] = ot;
  const oEnd = w.mk(O, 'saved') + 1.4, gFrom = w.start(G) + .4, gEnd = w.mk(G, 'grid') + 2.3;
  // The report's scroll down and back up is left out (the page is at its top again at 'up': no visible jump); still waits trimmed.
  const hero = w.tap(O, 'hero');
  const trims: [number, number][] = [[hero.on + 2.4, w.mk(O, 'up')], [yonet.tap! + 1.2, w.mk(O, 'screens') - .1], [more.tap! + .7, menu.on], [menu.tap! + .9, w.mk(O, 'list') - 1.7],
    [edit.tap! + 1.0, price.on]];
  const { map, at, d } = cutTimeline([{ hold: .4, at: w.mk(O, 'report') }, { from: w.mk(O, 'report'), to: oEnd }, { from: gFrom, to: gEnd }], [...leads([...ot, ...gt]), ...trims]);
  const s = swap(at(oEnd) - .3);
  return { name: 'uzak', file: '08-telefondan-yonet', seed: 43, track: 'Instagram Blok 2 - 08 Telefondan yönetim', duration: d, map,
    cover: { t: 1.0, title: 'İşletmenizi <em>telefondan</em> yönetin', sub: 'Bugünün satışı, menü ve fiyatlar' },
    captions: [
      { from: 0, to: at(yonet.tap!) - .1, text: 'Bugünün satışı<br><em>telefonunuzda</em>' },
      { from: at(yonet.tap!), to: at(edit.tap!) - .1, text: 'Menü yönetimine geçin' },
      { from: at(edit.tap!), to: at(save.tap!) - .1, text: 'Fiyatı değiştirin' },
      { from: at(save.tap!), to: at(oEnd) - .3, text: '“Kaydet ve yayınla”' },
      { from: at(oEnd) - .2, to: d + 1, text: 'QR menüde<br><em>yeni fiyat</em> hemen görünür' },
    ],
    devices: [
      { id: 'o', clip: O, kind: 'phone', label: 'İşletme sahibi', keys: [{ t: 0, ...show(CENTER.x, CENTER.y) }, ...s.out], ripples: ripplesOf(ot, at) },
      { id: 'g', clip: G, kind: 'phone', label: 'Müşteri', keys: [{ t: 0, ...hide(CENTER.x + 160, CENTER.y) }, ...s.in], ripples: ripplesOf(gt, at) },
    ] };
}

// ---------- The profile grid: the pinned row of blok 1, then posts 4–9 (Instagram puts the newest, 4, top left) ----------
const grid = () => gridOf([join(BLOK1, '01-marka-logo.jpg'), join(BLOK1, '02-marka-mola.jpg'), join(BLOK1, '03-marka-slogan.jpg'),
  join(OUT, '04-mutfak-kapak.jpg'), join(OUT, '05-qr-menu-urun.jpg'), join(OUT, '06-kampanya-kapak.jpg'),
  join(OUT, '07-masalar.jpg'), join(OUT, '08-telefondan-yonet-kapak.jpg'), join(OUT, '09-qr-payi.jpg')], join(OUT, '_izgara-onizleme.jpg'));

async function main() {
    const browser = await chromium.launch({ channel: process.env.SOSYAL_TARAYICI ?? 'chrome' });
  try {
    if (!stills) {
      if (wanted('5')) await render(browser, productHtml(), '05-qr-menu-urun');
      if (wanted('7')) await render(browser, floorHtml(), '07-masalar');
      if (wanted('9')) {
        // The report's card without its empty lower part: the title, the chart and its legend (inside the card's own border).
        const m = await sharp(join(SHOTS, 'qr-payi.png')).metadata(), region = { left: 4, top: 4, width: m.width! - 8, height: Math.round(m.height! * .69) };
        await sharp(join(SHOTS, 'qr-payi.png')).extract(region).toFile(join(WORK, 'qr-payi-kirp.png'));
        await render(browser, qrShareHtml(region.width, region.height), '09-qr-payi');
      }
    }
    for (const [name, make] of [['mutfak', mutfak], ['kampanya', kampanya], ['uzak', uzak]] as const) if (wanted(name)) await video(browser, make());
    if (!stills && wanted('izgara')) await grid();
  } finally { await browser.close(); }
}
await main();
