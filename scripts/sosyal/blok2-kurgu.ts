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
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from '@playwright/test';
import sharp from 'sharp';
import { C as C0, FFMPEG, FPS, ROOT, SANS, SERIF, base, cupPaths, img, mark, meta, yer, type Box, type TimeMap } from './youtube-sahne';

const REC = join(ROOT, '.local', 'sosyal', 'blok2', 'kayit');
const WORK = join(ROOT, '.local', 'sosyal', 'blok2', 'kurgu');
const OUT = resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola Instagram', 'Blok 2'));
const BLOK1 = join(ROOT, '..', 'Mola Instagram', 'Blok 1');
const MUSIC_DIR = join(ROOT, '..', 'Mola Müzik');
const SHOTS = join(REC, 'ekran');
yer({ rec: REC, work: WORK, out: OUT });
const args = process.argv.slice(2), stills = args.includes('--kare'), only = args.filter(a => !a.startsWith('--'));
const wanted = (name: string) => !only.length || only.includes(name);
const C = { ...C0, green100: '#e6efe7', accentSoft: '#f6e6dc' };
const cup = (size: number, color: string, stroke = 1.7) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${cupPaths}</svg>`;
const jpeg = async (png: Buffer, file: string) => writeFileSync(file, await sharp(png).jpeg({ quality: 93, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer());

// ---------- Images ----------
async function render(browser: Browser, html: string, name: string) {
  const htmlFile = join(WORK, `${name}.html`); writeFileSync(htmlFile, html);
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlFile).href);
  await page.evaluate('document.fonts.ready');
  await page.waitForFunction('[...document.images].every(function (i) { return i.complete && i.naturalWidth > 0; })');
  const png = await page.screenshot({ type: 'png' });
  writeFileSync(join(WORK, `${name}.png`), png);
  await jpeg(png, join(OUT, `${name}.jpg`));
  await page.close();
  console.log(`  ${name}.jpg`);
}
/** The green post of blok 1 (posts 5, 7, 9): eyebrow with the terracotta dashes, a serif title. */
const greenCss = `
  body{background:radial-gradient(80% 60% at 50% 30%,#2a5848 0%,${C.green} 62%,#1d4134 100%);color:${C.cup};text-align:center}
  .eyebrow{margin-top:78px;font:700 28px/1 ${SANS};letter-spacing:.3em;color:rgba(243,235,221,.8);display:flex;align-items:center;justify-content:center;gap:18px}
  .eyebrow::before,.eyebrow::after{content:"";width:44px;height:3px;background:${C.accent};border-radius:2px}
  h1{margin-top:30px;font-weight:400;font-size:80px;line-height:1.1;letter-spacing:-.02em}
  h1 em{font-style:italic;color:#efc2aa}
  .sub{margin-top:20px;font:32px/1.3 ${SANS};color:rgba(243,235,221,.85)}`;
const phoneCss = (sw: number) => {
  const sh = Math.round(sw * 844 / 390), pad = Math.round(sw * .03), r = Math.round(sw * .13);
  return `.phone{position:absolute;width:${sw + 2 * pad}px;height:${sh + 2 * pad}px;padding:${pad}px;border-radius:${r}px;background:#1c2721;box-shadow:0 60px 110px -40px rgba(0,0,0,.6),0 20px 40px -20px rgba(0,0,0,.4),inset 0 0 0 2px #3a4a41}
  .phone .screen{position:relative;width:${sw}px;height:${sh}px;border-radius:${r - pad}px;overflow:hidden;background:${C.paper}}
  .phone .screen img{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
  .phone .screen::after{content:"";position:absolute;top:${Math.round(sw * .022)}px;left:50%;width:${Math.round(sw * .03)}px;height:${Math.round(sw * .03)}px;margin-left:-${Math.round(sw * .015)}px;border-radius:50%;background:#1c2721;z-index:2}`;
};

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

// ---------- Videos: one wall clock for every recorded screen ----------
/*
 * The clips of one video were recorded at the same time (the tablet and the kitchen display) or one after the other (the
 * owner's phone, then the guest's). Every time below is wall-clock seconds from the video's reference clip start. The edit
 * keeps `pieces` of that clock (and may hold a moment still); the still lead-ins of the named taps (Recorder.tap) are cut.
 */
type Piece = { from: number; to: number } | { hold: number; at: number };
type Cut = { map: TimeMap; at: (w: number) => number; d: number };
const abs = (clip: string, t: number) => meta(clip).marks.start + t;
function wall(ref: string) {
  const r = meta(ref).marks.start;
  const mk = (clip: string, name: string) => { const v = meta(clip).marks[name]; if (v === undefined) throw new Error(`${clip}: işaret yok: ${name}`); return v - r; };
  const tap = (clip: string, name: string) => { const t = (meta(clip).taps ?? []).find(x => x.name === name); if (!t) throw new Error(`${clip}: dokunuş yok: ${name}`); return { box: t.box, on: t.on - r, tap: t.tap !== undefined ? t.tap - r : undefined, off: t.off !== undefined ? t.off - r : undefined }; };
  return { r, mk, tap, start: (clip: string) => meta(clip).marks.start - r };
}
/** The scene's clock from the kept pieces minus the cut spans (wall s). */
function cutTimeline(pieces: Piece[], cuts: [number, number][]): Cut {
  const parts: ({ c0: number; c1: number; s0: number } | { hold: number; c: number; s0: number })[] = [];
  let s = 0;
  const sorted = cuts.filter(([a, b]) => b - a > .2).sort((p, q) => p[0] - q[0]);
  for (const p of pieces) {
    if ('hold' in p) { parts.push({ hold: p.hold, c: p.at, s0: s }); s += p.hold; continue; }
    let c = p.from;
    for (const [a, b] of sorted) { if (b <= c || a >= p.to) continue; if (a > c) { parts.push({ c0: c, c1: a, s0: s }); s += a - c; } c = Math.max(c, b); }
    if (p.to > c) { parts.push({ c0: c, c1: p.to, s0: s }); s += p.to - c; }
  }
  const map: TimeMap = parts.flatMap(p => 'hold' in p ? [[p.s0, p.c], [p.s0 + p.hold - .0005, p.c]] as [number, number][] : [[p.s0, p.c0], [p.s0 + (p.c1 - p.c0) - .0005, p.c1]] as [number, number][]);
  const at = (w: number) => { for (const p of parts) { if ('hold' in p) continue; if (w <= p.c1) return p.s0 + Math.max(0, w - p.c0); } return s; };
  return { map, at, d: s };
}
/** The still lead-ins of these taps (Recorder.tap) as cut spans. */
const leads = (list: { on: number; tap?: number }[]) => list.filter(t => t.tap !== undefined).map(t => [t.on + .15, t.tap! - .4] as [number, number]);

type Key = { t: number; x: number; y: number; s?: number; o?: number };
type Ripple = { box: Box; from: number; to: number };
type Device = { id: string; clip: string; kind: 'phone' | 'tablet' | 'display'; keys: Key[]; ripples: Ripple[]; label: string; labelFrom?: number };
type Video = { name: string; file: string; seed: number; track: string; duration: number; map: TimeMap; devices: Device[]; captions: { from: number; to: number; text: string }[]; cover: { t: number; title: string; sub: string } };

/** Device sizes on the 1080×1920 stage: phone screen 440 px wide, tablet and kitchen display views 980 px wide. */
const PHONE_W = 440, VIEW_W = 980;
const CENTER = { x: 540, y: 1100 };
const ripplesOf = (list: { box: Box; tap?: number }[], at: (w: number) => number): Ripple[] => list.filter(t => t.tap !== undefined && t.box.width > 0).map(t => ({ box: t.box, from: at(t.tap!), to: at(t.tap!) + .45 }));

function stageHtml(v: Video) {
  const data = {
    duration: v.duration, map: v.map, captions: v.captions,
    devices: v.devices.map(d => { const m = meta(d.clip), r = meta(v.devices[0].clip).marks.start; return { ...d, size: m.size, frames: m.frames.map(f => ({ src: img(join(REC, d.clip, f.file)), t: f.t - r })) }; }),
  };
  const phone = (sw: number) => { const sh = Math.round(sw * 844 / 390), pad = Math.round(sw * .03), r = Math.round(sw * .13); return { sw, sh, pad, r }; };
  const p = phone(PHONE_W);
  return base(1080, 1920, `
  <div class="bg"></div>
  <div class="head">${mark(64)}<span class="serif">mola<i>.</i></span></div>
  <div class="cap" id="cap"><div></div></div>
  ${data.devices.map(d => `<div class="dev ${d.kind}" id="${d.id}"><div class="view"><img><div class="rings"></div></div></div><div class="label" id="${d.id}-label">${d.label}</div>`).join('')}
  <div class="foot"><b>molayazilim.com.tr</b><span>30 gün ücretsiz deneyin</span></div>
  <div class="fade" id="fade"></div>
  <script>
  const D = ${JSON.stringify(data)};
  const ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function key(list, t) {
    if (t <= list[0].t) return list[0];
    for (let i = 1; i < list.length; i++) if (t < list[i].t) { const a = list[i - 1], b = list[i], k = ease((t - a.t) / (b.t - a.t)); const o = {}; for (const f of ['x', 'y', 's', 'o']) o[f] = (a[f] ?? 1) + ((b[f] ?? 1) - (a[f] ?? 1)) * k; return o; }
    return list[list.length - 1];
  }
  function mapT(map, t) {
    if (t <= map[0][0]) return map[0][1] - (map[0][0] - t);
    for (let i = 1; i < map.length; i++) if (t < map[i][0]) { const [s0, c0] = map[i - 1], [s1, c1] = map[i]; return c0 + (c1 - c0) * (t - s0) / (s1 - s0); }
    const [s, c] = map[map.length - 1]; return c + (t - s);
  }
  function frameAt(frames, t) { let lo = 0, hi = frames.length - 1; if (t <= frames[0].t) return frames[0].src; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid].t <= t) lo = mid; else hi = mid - 1; } return frames[lo].src; }
  const pending = [];
  function setSrc(el, src) { if (el.getAttribute('src') !== src) { el.setAttribute('src', src); pending.push(el.decode().catch(() => {})); } }
  // Sizes: the phone's screen ${PHONE_W} px wide; the tablet and the kitchen display ${VIEW_W} px.
  D.devices.forEach(d => {
    const el = document.getElementById(d.id), view = el.querySelector('.view');
    if (d.kind === 'phone') { el.style.padding = '${p.pad}px'; el.style.borderRadius = '${p.r}px'; view.style.width = '${p.sw}px'; view.style.height = '${p.sh}px'; view.style.borderRadius = '${p.r - p.pad}px'; d.z = ${p.sw} / d.size.width; }
    else { const h = Math.round(${VIEW_W} * d.size.height / d.size.width); view.style.width = '${VIEW_W}px'; view.style.height = h + 'px'; d.z = ${VIEW_W} / d.size.width; }
  });
  window.renderAt = async function (t) {
    const w = mapT(D.map, t);
    for (const d of D.devices) {
      const el = document.getElementById(d.id), k = key(d.keys, t), lab = document.getElementById(d.id + '-label');
      el.style.transform = 'translate(' + (k.x - el.offsetWidth / 2) + 'px,' + (k.y - el.offsetHeight / 2) + 'px) scale(' + k.s + ')';
      el.style.opacity = k.o;
      const top = k.y - el.offsetHeight * k.s / 2 - 66;
      lab.style.transform = 'translate(' + (k.x - lab.offsetWidth / 2) + 'px,' + top + 'px)';
      lab.style.opacity = k.o * clamp((t - (d.labelFrom ?? -1)) / .35, 0, 1);
      if (k.o <= .001) continue;
      setSrc(el.querySelector('img'), frameAt(d.frames, w));
      // An ordinary tap: a soft translucent circle at the touch point, growing and fading in ~0.45 s.
      let html = '';
      for (const r of d.ripples) {
        const q = (t - r.from) / (r.to - r.from); if (q < 0 || q > 1) continue;
        const R = 30 * d.z * (.55 + .65 * q), cx = (r.box.x + r.box.width / 2) * d.z, cy = (r.box.y + r.box.height / 2) * d.z;
        html += '<b style="opacity:' + ((1 - q) * .9) + ';left:' + (cx - R) + 'px;top:' + (cy - R) + 'px;width:' + (2 * R) + 'px;height:' + (2 * R) + 'px"></b>';
      }
      el.querySelector('.rings').innerHTML = html;
    }
    const cap = document.getElementById('cap');
    if (D.cover) { cap.style.opacity = 1; cap.style.transform = 'none'; }
    else {
      const c = D.captions.find(c => t >= c.from && t < c.to);
      if (!c) cap.style.opacity = 0;
      else {
        if (cap.dataset.text !== c.text) { cap.firstChild.innerHTML = c.text; cap.dataset.text = c.text; }
        const inK = clamp((t - c.from) / .4, 0, 1), outK = c.to >= D.duration ? 1 : clamp((c.to - t) / .25, 0, 1);
        cap.style.opacity = Math.min(ease(inK), outK);
        cap.style.transform = 'translateY(' + ((1 - ease(inK)) * 24) + 'px)';
      }
    }
    // The end fades to the background (the 9:16 version also fades in from it; the 4:5 one starts from its cover).
    document.getElementById('fade').style.opacity = D.cover ? 0 : t > D.duration - .3 ? (t - (D.duration - .3)) / .3 : 0;
    await Promise.all(pending.splice(0));
  };
  window.coverMode = function (title, sub) {
    D.cover = true;
    const c = document.getElementById('cap'); c.classList.add('cover'); c.innerHTML = '<div>' + title + '</div><small>' + sub + '</small>';
    document.querySelector('.head').style.display = 'none'; document.querySelector('.foot').style.display = 'none';
  };
  </script>`, `
  body{background:${C.bg}}
  .bg{position:absolute;inset:0;background:radial-gradient(70% 40% at 85% 22%,rgba(214,220,200,.95),rgba(214,220,200,0)),radial-gradient(60% 35% at 10% 85%,rgba(246,230,220,.95),rgba(246,230,220,0)),${C.bg}}
  .head{position:absolute;top:118px;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:18px}
  .head svg{border-radius:16px}
  .head span{font-size:62px;line-height:1;color:${C.green};letter-spacing:-.03em}.head i{font-style:normal;color:${C.accent}}
  .cap{position:absolute;left:50px;right:50px;top:318px;height:200px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font:400 64px/1.13 ${SERIF};color:${C.green900};letter-spacing:-.015em;opacity:0;z-index:5}
  .cap em{font-style:italic;color:${C.accent}}
  .cap.cover{top:300px;height:240px;font-size:70px;line-height:1.08}
  .cap small{display:block;margin-top:18px;font:600 32px/1.3 ${SANS};color:${C.muted};letter-spacing:0}
  .dev{position:absolute;left:0;top:0;transform-origin:50% 50%;will-change:transform}
  .dev .view{position:relative;overflow:hidden;background:${C.paper}}.dev .view img{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
  .dev.phone{background:#1c2721;box-shadow:0 60px 110px -40px rgba(22,51,40,.55),0 20px 40px -20px rgba(22,51,40,.35),inset 0 0 0 2px #3a4a41}
  .dev.tablet{padding:22px;border-radius:40px;background:#1c2721;box-shadow:0 50px 90px -40px rgba(22,51,40,.55),inset 0 0 0 2px #3a4a41}
  .dev.tablet .view{border-radius:14px}
  .dev.display{padding:16px 16px 30px;border-radius:18px;background:#222c27;box-shadow:0 50px 90px -40px rgba(22,51,40,.55),inset 0 0 0 2px #3a4a41}
  .dev.display .view{border-radius:5px}
  .rings{position:absolute;inset:0;pointer-events:none}
  .rings b{position:absolute;border-radius:50%;background:rgba(255,255,255,.38);border:2px solid rgba(35,76,62,.32);box-shadow:0 0 0 5px rgba(35,76,62,.07)}
  .label{position:absolute;left:0;top:0;background:${C.green};color:${C.cup};font:700 28px/1 ${SANS};padding:13px 26px;border-radius:999px;opacity:0;white-space:nowrap;z-index:4}
  .foot{position:absolute;left:0;right:0;top:1688px;text-align:center}
  .foot b{display:block;font:700 40px/1 ${SANS};color:${C.green}}
  .foot span{display:block;margin-top:14px;font:600 28px/1 ${SANS};color:${C.muted}}
  .fade{position:absolute;inset:0;background:${C.bg};pointer-events:none;z-index:9}`);
}

/** The 4:5 post is the stage's central 1080×1350 (y 285–1635). */
const CROP_Y = 285;
async function stagePage(browser: Browser, v: Video) {
  const htmlFile = join(WORK, `${v.name}.html`); writeFileSync(htmlFile, stageHtml(v));
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlFile).href);
  await page.evaluate('document.fonts.ready');
  return page;
}
const run = (args: string[], what: string) => { const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${what}: ${r.stderr}`); };
const ENC = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(FPS), '-g', String(FPS * 2), '-movflags', '+faststart'];
const KEYS: Record<number, string> = { 0: 'Do', 2: 'Re', [-3]: 'La', 5: 'Fa', [-5]: 'Sol', [-1]: 'Si' };
/** The key and tempo muzik.py draws for cesit-N (its first two choices from the seed). */
function trackInfo(seed: number) {
  const py = spawnSync('python', ['-c', `import numpy as np\nr=np.random.default_rng(${1000 + seed})\nprint(int(r.choice([0,2,-3,5,-5,-1])), int(r.choice([96,100,104,108])))`], { encoding: 'utf8' });
  const [kok, bpm] = py.stdout.trim().split(/\s+/).map(Number);
  return { key: `${KEYS[kok]} majör`, bpm };
}
/** The music for `seconds` (cesit-N) and the gain that brings it to about −20 LUFS. */
function music(seed: number, seconds: number, file: string) {
  const py = spawnSync('python', [join(ROOT, 'scripts', 'sosyal', 'muzik.py'), file, seconds.toFixed(3), `cesit-${seed}`], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (py.status !== 0) throw new Error(`Müzik üretilemedi: ${py.stderr}`);
  const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const lufs = Number([...probe.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1)?.[1]);
  return { lufs, gain: (-20 - lufs).toFixed(2) };
}

async function video(browser: Browser, v: Video) {
  const page = await stagePage(browser, v);
  if (stills) {
    mkdirSync(join(WORK, 'kare'), { recursive: true });
    for (const k of [.03, .15, .3, .45, .6, .75, .9, .99]) { const t = v.duration * k; await page.evaluate(`renderAt(${t})`); writeFileSync(join(WORK, 'kare', `${v.name}-${t.toFixed(1)}.jpg`), await page.screenshot({ type: 'jpeg', quality: 80 })); }
    await page.close(); console.log(`  kareler: ${join(WORK, 'kare')}`); return;
  }
  // The stage, every frame (no sound yet).
  const stage = join(WORK, `${v.name}-sahne.mp4`), total = Math.round(v.duration * FPS);
  const ff = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-vf', 'scale=1080:1920:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(FPS), stage], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise<number>(r => ff.on('exit', c => r(c ?? 1)));
  const write = (b: Buffer) => new Promise<void>(r => { if (ff.stdin.write(b)) r(); else ff.stdin.once('drain', () => r()); });
  const t0 = Date.now();
  for (let i = 0; i < total; i++) { await page.evaluate(`renderAt(${(i / FPS).toFixed(4)})`); await write(await page.screenshot({ type: 'jpeg', quality: 95 })); }
  ff.stdin.end();
  if (await done !== 0) throw new Error(`${v.name}: ffmpeg başarısız.`);
  // The cover: one settled moment with the cover title in the caption's place, the 4:5 part.
  await page.evaluate(`renderAt(${v.cover.t})`);
  await page.evaluate(`coverMode(${JSON.stringify(v.cover.title)}, ${JSON.stringify(v.cover.sub)})`);
  await page.evaluate(`renderAt(${v.cover.t})`);
  const coverPng = join(WORK, `${v.file}-kapak.png`);
  writeFileSync(coverPng, await page.screenshot({ clip: { x: 0, y: CROP_Y, width: 1080, height: 1350 } }));
  await jpeg(await sharp(coverPng).toBuffer(), join(OUT, `${v.file}-kapak.jpg`));
  await page.close();
  console.log(`  ${v.name}: sahne ${(Date.now() - t0) / 1000 | 0} sn'de`);

  const len = total / FPS, COVER = 1, XF = .35, len45 = COVER + len;
  const w45 = join(WORK, `${v.name}-muzik-4x5.wav`), w916 = join(WORK, `${v.name}-muzik-9x16.wav`);
  const m45 = music(v.seed, len45, w45), m916 = music(v.seed, len, w916);
  // 4:5: the cover for 1 s, a 0.35 s fade into the crop (the stage at its own time 0), the music.
  run(['-loop', '1', '-framerate', String(FPS), '-t', String(COVER + XF), '-i', coverPng, '-i', stage, '-i', w45,
    '-filter_complex', `[0:v]scale=1080:1350:out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1,fps=${FPS}[c];[1:v]crop=1080:1350:0:${CROP_Y},setsar=1,fps=${FPS}[s];[c][s]xfade=transition=fade:duration=${XF}:offset=${COVER}[v];[2:a]volume=${m45.gain}dB,aresample=48000[a]`,
    '-map', '[v]', '-map', '[a]', ...ENC, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', len45.toFixed(3), join(OUT, `${v.file}-4x5.mp4`)], `${v.file}-4x5`);
  // 9:16 (stories): the whole stage, fading in from the background.
  run(['-i', stage, '-i', w916, '-filter_complex', `[0:v]fade=t=in:st=0:d=0.3:color=${C.bg}[v];[1:a]volume=${m916.gain}dB,aresample=48000[a]`,
    '-map', '[v]', '-map', '[a]', ...ENC, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', len.toFixed(3), join(OUT, `${v.file}.mp4`)], v.file);
  // The track in Mola Müzik (the 4:5 post's length, at its level).
  const ti = trackInfo(v.seed);
  mkdirSync(MUSIC_DIR, { recursive: true });
  run(['-i', w45, '-af', `volume=${m45.gain}dB`, '-c:a', 'libmp3lame', '-b:a', '192k', join(MUSIC_DIR, `${v.track} (${ti.key}, ${ti.bpm} tempo).mp3`)], 'mp3');
  console.log(`  ${v.file}-4x5.mp4 · ${len45.toFixed(2)} sn · ${v.file}.mp4 · ${len.toFixed(2)} sn · müzik cesit-${v.seed} (${ti.key}, ${ti.bpm}) ${m45.lufs.toFixed(1)} → −20 LUFS`);
}

// ---------- The three videos ----------
const show = (x: number, y: number, s = 1): Omit<Key, 't'> => ({ x, y, s, o: 1 });
const hide = (x: number, y: number, s = .96): Omit<Key, 't'> => ({ x, y, s, o: 0 });
/** One device leaves (to the left) while the next comes in (from the right) at scene time `t`. */
function swap(t: number, d = .6) {
  return { out: [{ t, ...show(CENTER.x, CENTER.y) }, { t: t + d, ...hide(CENTER.x - 160, CENTER.y) }], in: [{ t, ...hide(CENTER.x + 160, CENTER.y) }, { t: t + d, ...show(CENTER.x, CENTER.y) }] };
}

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
async function grid() {
  const tile = { w: 360, h: 450 }, gap = 4;
  const files = [join(BLOK1, '01-marka-logo.jpg'), join(BLOK1, '02-marka-mola.jpg'), join(BLOK1, '03-marka-slogan.jpg'),
    join(OUT, '04-mutfak-kapak.jpg'), join(OUT, '05-qr-menu-urun.jpg'), join(OUT, '06-kampanya-kapak.jpg'),
    join(OUT, '07-masalar.jpg'), join(OUT, '08-telefondan-yonet-kapak.jpg'), join(OUT, '09-qr-payi.jpg')];
  for (const f of files) if (!existsSync(f)) throw new Error(`Izgara için eksik: ${f}`);
  const parts = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(tile.w, tile.h, { fit: 'cover' }).toBuffer(), left: (i % 3) * (tile.w + gap), top: Math.floor(i / 3) * (tile.h + gap) })));
  await sharp({ create: { width: 3 * tile.w + 2 * gap, height: 3 * tile.h + 2 * gap, channels: 3, background: '#ffffff' } }).composite(parts).jpeg({ quality: 90, mozjpeg: true }).toFile(join(OUT, '_izgara-onizleme.jpg'));
  console.log('  _izgara-onizleme.jpg');
}

async function main() {
  mkdirSync(WORK, { recursive: true }); mkdirSync(OUT, { recursive: true });
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
