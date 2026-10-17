/*
 * Instagram blok 1 (QR menü ve sipariş): the nine posts, made from the recordings of scripts/sosyal/blok1-kayit.ts.
 *
 *   npx tsx scripts/sosyal/blok1-kurgu.ts                 everything
 *   npx tsx scripts/sosyal/blok1-kurgu.ts 1 5 siparis     only these (1 2 3 5 7 9: images; siparis garson hesap: videos)
 *   npx tsx scripts/sosyal/blok1-kurgu.ts --kapak siparis   only the video covers
 *   SOSYAL_CIKTI=<klasör> …                                another output folder
 *
 * Images: HTML in Chrome (site colours, Georgia + Segoe UI as on molayazilim.com.tr) → 1080×1350 JPEG.
 * Videos: an HTML stage (1080×1920) is drawn for every frame at 30 fps from the 3× phone recordings (phone mockup, captions,
 * the staff screen), each frame a screenshot piped to ffmpeg → H.264 High, yuv420p (BT.709), no audio track. Everything
 * important stays inside the central 1080×1350 (the profile grid's crop). Cover: that central part of one frame, as JPEG.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import sharp from 'sharp';

const ROOT = resolve('.');
const REC = join(ROOT, '.local', 'sosyal', 'blok1', 'kayit');
const WORK = join(ROOT, '.local', 'sosyal', 'blok1', 'kurgu');
const OUT = resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola Instagram', 'Blok 1'));
const FFMPEG = process.env.FFMPEG ?? 'C:\\FFmpeg\\bin\\ffmpeg.exe';
const coversOnly = process.argv.includes('--kapak'), only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const wanted = (name: string) => !only.length || only.includes(name);
mkdirSync(WORK, { recursive: true }); mkdirSync(OUT, { recursive: true });

// ---------- Brand (site/src/assets/site.css) ----------
const C = { green900: '#163328', green: '#234c3e', green700: '#2c5c4a', green500: '#4f8566', green200: '#cfe0d3', green100: '#e6efe7', sage: '#e4e4d2', cream: '#e6dfd1', bg: '#ece6da', paper: '#f6f1e8', ink: '#1f3128', body: '#33463c', muted: '#5a6a61', line: '#ddd5c6', accent: '#b96844', accentSoft: '#f6e6dc', cup: '#f3ebdd' };
const SERIF = `Georgia, 'Times New Roman', serif`, SANS = `'Segoe UI', system-ui, Arial, sans-serif`;
const cupPaths = `<path d="M10 2v2"/><path d="M14 2v2"/><path d="M6 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/>`;
const cup = (size: number, color: string, stroke = 1.7) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${cupPaths}</svg>`;
/** The app icon (public/favicon.svg): green rounded square, cream cup. */
const mark = (size: number) => `<svg width="${size}" height="${size}" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="${C.green}"/><g transform="translate(41.6 45.2) scale(7.2)" fill="none" stroke="${C.cup}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${cupPaths}</g></svg>`;
const check = (size: number, color: string) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
const base = (w: number, h: number, body: string, css = '') => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}html,body{width:${w}px;height:${h}px;overflow:hidden}
  body{font-family:${SANS};-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
  .serif{font-family:${SERIF}}${css}</style></head><body>${body}</body></html>`;
const img = (file: string) => pathToFileURL(file).href;

async function render(browser: Browser, html: string, w: number, h: number, name: string, clips?: { x: number; file: string }[]) {
  const htmlFile = join(WORK, `${name}.html`); writeFileSync(htmlFile, html);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlFile).href);
  await page.evaluate('document.fonts.ready');
  await page.waitForFunction('[...document.images].every(function (i) { return i.complete && i.naturalWidth > 0; })');
  for (const c of clips ?? [{ x: 0, file: name }]) {
    const png = await page.screenshot({ clip: { x: c.x, y: 0, width: 1080, height: 1350 } });
    writeFileSync(join(WORK, `${c.file}.png`), png);
    await jpeg(png, join(OUT, `${c.file}.jpg`));
  }
  await page.close();
}
const jpeg = async (png: Buffer, file: string) => writeFileSync(file, await sharp(png).jpeg({ quality: 93, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer());

// ---------- Posts 1–3: one banner over three tiles ----------
/*
 * 3240×1350, cut into three 1080×1350 tiles: green · cream · green. One terracotta line runs through all three at the same
 * height (flat where the tiles meet, so it joins across the grid's gaps and crops); every tile's main element stands on it,
 * and each tile reads on its own in the feed.
 */
function bannerHtml() {
  const LINE = 1012;
  return base(3240, 1350, `
  <div class="t t1"></div><div class="t t2"></div><div class="t t3"></div>
  <div class="line"></div>
  <div class="logo"><div class="disc">${cup(300, C.green, 1.45)}</div></div>
  <div class="below b1">ELAZIĞ’DAN</div>
  <div class="word serif">mola<i>.</i></div>
  <div class="below b2">ADİSYON · QR MENÜ</div>
  <div class="slogan serif">Kafenize<br><em>güzel bir mola</em><br>verin.</div>
  <div class="below b3">molayazilim.com.tr</div>`, `
  .t{position:absolute;top:0;width:1080px;height:1350px}
  .t1{left:0;background:radial-gradient(90% 70% at 50% 38%,#2a5848 0%,${C.green} 60%,#1d4134 100%)}
  .t2{left:1080px;background:radial-gradient(90% 70% at 50% 38%,#f4eee3 0%,${C.bg} 70%,#e3dccd 100%)}
  .t3{left:2160px;background:radial-gradient(90% 70% at 50% 38%,#2a5848 0%,${C.green} 60%,#1d4134 100%)}
  .line{position:absolute;left:0;right:0;top:${LINE}px;height:4px;background:${C.accent}}
  .logo{position:absolute;left:0;width:1080px;top:0;height:${LINE}px;display:grid;place-items:center}
  .disc{width:540px;height:540px;border-radius:50%;background:${C.cup};display:grid;place-items:center;box-shadow:0 40px 80px -30px rgba(0,0,0,.45);margin-top:40px}
  .disc svg{margin:-10px 0 0 22px}
  .below{position:absolute;top:${LINE + 62}px;width:1080px;text-align:center;font:700 34px/1 ${SANS};letter-spacing:.32em;padding-left:.32em}
  .b1{left:0;color:rgba(243,235,221,.82)}
  .b2{left:1080px;color:${C.green700}}
  .b3{left:2160px;color:rgba(243,235,221,.82);letter-spacing:.08em;padding-left:.08em;font-weight:600;font-size:38px}
  .word{position:absolute;left:1080px;width:1080px;text-align:center;top:${LINE - 395}px;font-size:340px;line-height:1;color:${C.green};letter-spacing:-.035em}
  .word i{font-style:normal;color:${C.accent}}
  .slogan{position:absolute;left:2160px;width:1080px;text-align:center;bottom:${1350 - LINE + 70}px;font-size:112px;line-height:1.12;color:${C.cup};letter-spacing:-.02em}
  .slogan em{font-style:italic;color:#efc2aa}`);
}

// ---------- Post 5: the menu photo ----------
function menuPhotoHtml() {
  return base(1080, 1350, `
  <div class="eyebrow">QR MENÜ</div>
  <h1 class="serif">Menünüz fotoğraflı,<br><em>her zaman güncel.</em></h1>
  <div class="card">
    <div class="photo"><img src="${img(join(ROOT, 'templates', 'gorseller', 'latte.webp'))}"></div>
    <div class="info">
      <small>#17 · Kahveler</small>
      <div class="row"><div><b class="serif">Caffè Latte</b><p>Çift shot espresso ve kadifemsi süt köpüğü.</p></div><div class="price"><span>₺140</span><i>+</i></div></div>
    </div>
  </div>
  <div class="foot">Fiyatı, fotoğrafı ya da “tükendi”yi değiştirin; QR menüde hemen görünür.</div>`, `
  body{background:radial-gradient(80% 60% at 50% 30%,#2a5848 0%,${C.green} 62%,#1d4134 100%);color:${C.cup};text-align:center}
  .eyebrow{margin-top:78px;font:700 28px/1 ${SANS};letter-spacing:.3em;color:rgba(243,235,221,.8);display:flex;align-items:center;justify-content:center;gap:18px}
  .eyebrow::before,.eyebrow::after{content:"";width:44px;height:3px;background:${C.accent};border-radius:2px}
  h1{margin-top:30px;font-weight:400;font-size:80px;line-height:1.1;letter-spacing:-.02em}
  h1 em{font-style:italic;color:#efc2aa}
  .card{position:absolute;left:150px;right:150px;top:372px;background:${C.paper};border-radius:44px;overflow:hidden;box-shadow:0 50px 90px -40px rgba(0,0,0,.6);text-align:left}
  .photo{height:560px;overflow:hidden;background:#efebe4}.photo img{width:100%;height:100%;object-fit:cover;object-position:50% 50%}
  .info{padding:28px 40px 34px}
  small{font:600 21px/1 ${SANS};letter-spacing:.06em;color:#8a958c}
  .row{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-top:14px}
  b{display:block;font-weight:400;font-size:50px;color:${C.ink};letter-spacing:-.01em}
  p{font:24px/1.35 ${SANS};color:${C.muted};margin-top:8px}
  .price{display:flex;align-items:center;gap:18px;flex:none}
  .price span{font:700 40px/1 ${SANS};color:${C.ink}}
  .price i{width:62px;height:62px;border-radius:50%;background:${C.cream};color:${C.ink};font:400 44px/62px ${SANS};font-style:normal;text-align:center}
  .foot{position:absolute;left:120px;right:120px;bottom:64px;font:26px/1.4 ${SANS};color:rgba(243,235,221,.82)}`);
}

// ---------- Phone mockup (as the site's .phone) ----------
const phoneCss = (sw: number) => {
  const sh = Math.round(sw * 844 / 390), pad = Math.round(sw * .03), r = Math.round(sw * .13);
  return `.phone{position:absolute;width:${sw + 2 * pad}px;height:${sh + 2 * pad}px;padding:${pad}px;border-radius:${r}px;background:#1c2721;box-shadow:0 60px 110px -40px rgba(22,51,40,.55),0 20px 40px -20px rgba(22,51,40,.35),inset 0 0 0 2px #3a4a41}
  .phone .screen{position:relative;width:${sw}px;height:${sh}px;border-radius:${r - pad}px;overflow:hidden;background:${C.paper}}
  .phone .screen img{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
  .phone .screen::after{content:"";position:absolute;top:${Math.round(sw * .022)}px;left:50%;width:${Math.round(sw * .03)}px;height:${Math.round(sw * .03)}px;margin-left:-${Math.round(sw * .015)}px;border-radius:50%;background:#1c2721;z-index:2}`;
};

// ---------- Post 7: the QR menu on a phone ----------
function phoneShotHtml() {
  const sw = 560;
  return base(1080, 1350, `
  <div class="eyebrow">QR MENÜ</div>
  <h1 class="serif">Okutun, menü açılsın.</h1>
  <p class="sub">Uygulama indirmek yok, üye olmak yok.</p>
  <div class="phone" style="left:${540 - sw / 2 - Math.round(sw * .03)}px;top:430px"><div class="screen"><img src="${img(join(REC, 'ekran', 'menu-ust.png'))}"></div></div>
  <div class="badge b1"><span>${cup(30, C.green, 2)}</span><div><b>Fotoğraflı menü</b><small>Kategoriler, arama</small></div></div>
  <div class="badge b2"><span class="t">EN</span><div><b>Türkçe · English</b><small>Tek dokunuşla</small></div></div>`, `
  body{background:radial-gradient(80% 60% at 50% 30%,#2a5848 0%,${C.green} 62%,#1d4134 100%);color:${C.cup};text-align:center}
  .eyebrow{margin-top:78px;font:700 28px/1 ${SANS};letter-spacing:.3em;color:rgba(243,235,221,.8);display:flex;align-items:center;justify-content:center;gap:18px}
  .eyebrow::before,.eyebrow::after{content:"";width:44px;height:3px;background:${C.accent};border-radius:2px}
  h1{margin-top:30px;font-weight:400;font-size:84px;line-height:1.1;letter-spacing:-.02em}
  .sub{margin-top:20px;font:32px/1.3 ${SANS};color:rgba(243,235,221,.85)}
  ${phoneCss(sw)}
  .badge{position:absolute;display:flex;align-items:center;gap:16px;background:${C.paper};border-radius:26px;padding:16px 26px 16px 16px;box-shadow:0 30px 60px -24px rgba(0,0,0,.55);text-align:left;color:${C.ink}}
  .badge span{width:60px;height:60px;border-radius:18px;background:${C.green100};display:grid;place-items:center;flex:none}
  .badge span.t{background:${C.accentSoft};color:${C.accent};font:800 22px/1 ${SANS}}
  .badge b{display:block;font:700 25px/1.2 ${SANS}}.badge small{display:block;font:21px/1.3 ${SANS};color:${C.muted};margin-top:3px}
  .b1{left:64px;top:900px}.b2{right:64px;top:1110px}`);
}

// ---------- Post 9: 30 days free ----------
function trialHtml() {
  const items = ['30 gün her şey açık', 'Kredi kartı istemeyiz', 'Kurulum ücretsiz', 'Deneme bitince kendiliğinden ücretli olmaz'];
  return base(1080, 1350, `
  <div class="eyebrow">ÜCRETSİZ DENEME</div>
  <div class="big serif">30 gün</div>
  <div class="lead serif"><em>ücretsiz deneyin.</em></div>
  <ul>${items.map(t => `<li><span>${check(28, C.green)}</span>${t}</li>`).join('')}</ul>
  <div class="cta">molayazilim.com.tr <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="${C.green}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></div>
  <div class="foot">${mark(44)}<span>Elazığ’da kurulum ve ilk eğitim işletmenizde</span></div>`, `
  body{background:radial-gradient(80% 60% at 50% 30%,#2a5848 0%,${C.green} 62%,#1d4134 100%);color:${C.cup};text-align:center}
  .eyebrow{margin-top:104px;font:700 28px/1 ${SANS};letter-spacing:.3em;color:rgba(243,235,221,.8);display:flex;align-items:center;justify-content:center;gap:18px}
  .eyebrow::before,.eyebrow::after{content:"";width:44px;height:3px;background:${C.accent};border-radius:2px}
  .big{margin-top:18px;font-size:240px;line-height:1;letter-spacing:-.04em}
  .lead{font-size:92px;line-height:1.1;margin-top:34px}.lead em{font-style:italic;color:#efc2aa}
  ul{list-style:none;width:860px;margin:62px auto 0;text-align:left}
  li{display:flex;align-items:center;gap:24px;font:600 34px/1.25 ${SANS};padding:15px 0;border-bottom:1px solid rgba(243,235,221,.16)}
  li:last-child{border-bottom:0}
  li span{width:52px;height:52px;border-radius:50%;background:${C.cup};display:grid;place-items:center;flex:none}
  .cta{display:inline-flex;align-items:center;gap:16px;margin-top:64px;background:${C.cup};color:${C.green};font:700 42px/1 ${SANS};padding:28px 46px;border-radius:999px;box-shadow:0 24px 50px -24px rgba(0,0,0,.6)}
  .foot{position:absolute;left:0;right:0;bottom:56px;display:flex;align-items:center;justify-content:center;gap:16px;font:26px/1 ${SANS};color:rgba(243,235,221,.8)}
  .foot svg{border-radius:12px;box-shadow:0 0 0 2px rgba(243,235,221,.35)}`);
}

// ---------- Videos ----------
type Meta = { size: { width: number; height: number; scale: number }; frames: { file: string; t: number }[]; marks: Record<string, number> };
const meta = (clip: string) => JSON.parse(readFileSync(join(REC, clip, 'meta.json'), 'utf8')) as Meta;
/** Recording times relative to the clip's start mark. */
function timeline(clip: string) {
  const m = meta(clip), s = m.marks.start;
  return { dir: join(REC, clip), frames: m.frames.map(f => ({ src: img(join(REC, clip, f.file)), t: f.t - s })), marks: Object.fromEntries(Object.entries(m.marks).map(([k, v]) => [k, v - s])) as Record<string, number> };
}
type Key = { t: number; x: number; y: number; s: number; o?: number };
type Region = { t: number; x: number; y: number; w: number };
type Scene = {
  name: string; duration: number; cover: { t: number; title: string; sub: string };
  captions: { from: number; to: number; text: string; last?: boolean }[];
  zooms?: { clip: string; freeze?: number; screen: { w: number; h: number }; region: { x: number; y: number; w: number; h: number }; width: number; keys: Key[] }[];
  phones: { id: string; clip: string; offset?: number; keys: Key[]; label?: string; labelFrom?: number }[];
  window?: { clip: string; title: string; keys: Key[]; regions: Region[] };
};
const SW = 476; // phone screen width on the 1080×1920 stage (1170 px frames → 0.41)
function stageHtml(scene: Scene) {
  const data = {
    duration: scene.duration, captions: scene.captions,
    phones: scene.phones.map(p => ({ ...p, frames: timeline(p.clip).frames })),
    window: scene.window ? { ...scene.window, frames: timeline(scene.window.clip).frames } : null,
    zooms: (scene.zooms ?? []).map(z => ({ ...z, frames: timeline(z.clip).frames })),
  };
  return base(1080, 1920, `
  <div class="bg"></div>
  <div class="head">${mark(64)}<span class="serif">mola<i>.</i></span></div>
  <div class="cap" id="c0"></div>
  ${scene.window ? `<div class="win" id="win"><div class="bar"><span></span><span></span><span></span><em>${scene.window.title}</em></div><div class="view"><img id="winimg"></div></div>` : ''}
  ${scene.phones.map(p => `<div class="phone" id="${p.id}"><div class="screen"><img></div></div>${p.label ? `<div class="label" id="${p.id}label">${p.label}</div>` : ''}`).join('')}
  ${(scene.zooms ?? []).map((z, i) => `<div class="zoom" id="z${i}"><div class="view"><img></div></div>`).join('')}
  <div class="foot"><b>molayazilim.com.tr</b><span>30 gün ücretsiz deneyin</span></div>
  <div class="fade" id="fade"></div>
  <script>
  const D = ${JSON.stringify(data)};
  const ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function key(list, t) {
    if (t <= list[0].t) return list[0];
    for (let i = 1; i < list.length; i++) if (t < list[i].t) { const a = list[i - 1], b = list[i], k = ease((t - a.t) / (b.t - a.t)); const o = {}; for (const f of Object.keys(b)) o[f] = (a[f] ?? 1) + ((b[f] ?? 1) - (a[f] ?? 1)) * k; return o; }
    return list[list.length - 1];
  }
  function frameAt(frames, t) { let lo = 0, hi = frames.length - 1; if (t <= frames[0].t) return frames[0].src; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid].t <= t) lo = mid; else hi = mid - 1; } return frames[lo].src; }
  const pending = [];
  function setSrc(el, src) { if (el.getAttribute('src') !== src) { el.setAttribute('src', src); pending.push(el.decode().catch(() => {})); } }
  window.renderAt = async function (t) {
    for (const p of D.phones) {
      const el = document.getElementById(p.id), k = key(p.keys, t);
      el.style.transform = 'translate(' + (k.x - el.offsetWidth / 2) + 'px,' + (k.y - el.offsetHeight / 2) + 'px) scale(' + k.s + ')';
      el.style.opacity = k.o ?? 1;
      setSrc(el.querySelector('img'), frameAt(p.frames, t - (p.offset || 0)));
      const lab = document.getElementById(p.id + 'label');
      if (lab) { const top = k.y - el.offsetHeight * k.s / 2 - 64; lab.style.transform = 'translate(' + (k.x - lab.offsetWidth / 2) + 'px,' + top + 'px)'; lab.style.opacity = clamp((t - (p.labelFrom ?? 0)) / .35, 0, 1) * (k.o ?? 1); }
    }
    if (D.window) {
      const w = document.getElementById('win'), k = key(D.window.keys, t), r = key(D.window.regions, t), im = document.getElementById('winimg');
      w.style.transform = 'translate(' + (k.x - w.offsetWidth / 2) + 'px,' + (k.y - w.offsetHeight / 2) + 'px) scale(' + k.s + ')';
      w.style.opacity = k.o ?? 1;
      const view = w.querySelector('.view'), z = view.offsetWidth / r.w;
      im.style.width = (1280 * z) + 'px'; im.style.height = (800 * z) + 'px'; im.style.transform = 'translate(' + (-r.x * z) + 'px,' + (-r.y * z) + 'px)';
      setSrc(im, frameAt(D.window.frames, t));
    }
    // Captions: the current one fades and rises in, the old one fades out (two layers for the crossfade).
    // Zoomed callouts: a live, enlarged part of a screen (what the staff sees, readable on a phone).
    (D.zooms || []).forEach((z, i) => {
      const el = document.getElementById('z' + i), k = key(z.keys, t), view = el.querySelector('.view'), im = el.querySelector('img');
      view.style.width = z.width + 'px'; view.style.height = (z.width * z.region.h / z.region.w) + 'px';
      const zz = z.width / z.region.w;
      im.style.width = (z.screen.w * zz) + 'px'; im.style.height = (z.screen.h * zz) + 'px'; im.style.transform = 'translate(' + (-z.region.x * zz) + 'px,' + (-z.region.y * zz) + 'px)';
      el.style.transform = 'translate(' + (k.x - el.offsetWidth / 2) + 'px,' + (k.y - el.offsetHeight / 2) + 'px) scale(' + k.s + ')';
      el.style.opacity = k.o ?? 1;
      if ((k.o ?? 1) > 0) setSrc(im, frameAt(z.frames, Math.min(t, z.freeze ?? 1e9)));
    });
    // Captions one after another: each fades and rises in, then fades out before the next.
    if (!D.cover) {
      const l = document.getElementById('c0'), c = D.captions.find(c => t >= c.from && t < c.to);
      if (!c) l.style.opacity = 0;
      else {
        if (l.dataset.text !== c.text) { l.innerHTML = '<div>' + c.text + '</div>'; l.dataset.text = c.text; }
        const inK = clamp((t - c.from) / .4, 0, 1), outK = c.last ? 1 : clamp((c.to - t) / .25, 0, 1);
        l.style.opacity = Math.min(ease(inK), outK);
        l.style.transform = 'translateY(' + ((1 - ease(inK)) * 26) + 'px)';
      }
    }
    const f = document.getElementById('fade'); f.style.opacity = D.cover ? 0 : t < .3 ? 1 - t / .3 : t > D.duration - .3 ? (t - (D.duration - .3)) / .3 : 0;
    await Promise.all(pending.splice(0));
  };
  window.coverMode = function (title, sub) {
    D.cover = true;
    const c = document.getElementById('c0'); c.classList.add('cover'); c.innerHTML = '<div>' + title + '</div><small>' + sub + '</small>'; c.dataset.text = 'kapak'; c.style.opacity = 1; c.style.transform = 'none';
    document.querySelector('.head').style.display = 'none';
    document.querySelector('.foot').style.display = 'none';
  };
  </script>`, `
  body{background:${C.bg}}
  .bg{position:absolute;inset:0;background:radial-gradient(70% 40% at 85% 22%,rgba(214,220,200,.95),rgba(214,220,200,0)),radial-gradient(60% 35% at 10% 85%,rgba(246,230,220,.95),rgba(246,230,220,0)),${C.bg}}
  .head{position:absolute;top:118px;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:18px}
  .head svg{border-radius:16px}
  .head span{font-size:62px;line-height:1;color:${C.green};letter-spacing:-.03em}.head i{font-style:normal;color:${C.accent}}
  .cap{position:absolute;left:60px;right:60px;top:318px;height:200px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font:400 66px/1.13 ${SERIF};color:${C.green900};letter-spacing:-.015em;opacity:0}
  .cap em{font-style:italic;color:${C.accent}}
  .cap.cover{top:292px;height:250px;font-size:68px;line-height:1.08}
  .zoom{position:absolute;left:0;top:0;padding:10px;background:${C.paper};border-radius:30px;box-shadow:0 40px 80px -30px rgba(22,51,40,.6),0 0 0 3px ${C.accent};transform-origin:50% 50%}
  .zoom .view{position:relative;overflow:hidden;border-radius:20px}.zoom .view img{position:absolute;left:0;top:0;transform-origin:0 0}
  .cap small{display:block;margin-top:18px;font:600 32px/1.3 ${SANS};color:${C.muted};letter-spacing:0}
  ${phoneCss(SW)}
  .phone{left:0;top:0;transform-origin:50% 50%}
  .win{position:absolute;left:0;top:0;width:1000px;background:${C.paper};border-radius:26px;overflow:hidden;box-shadow:0 60px 110px -40px rgba(22,51,40,.55),0 0 0 2px ${C.line};transform-origin:50% 50%}
  .win .bar{display:flex;align-items:center;gap:10px;height:52px;padding:0 22px;background:${C.cream};border-bottom:2px solid ${C.line}}
  .win .bar span{width:15px;height:15px;border-radius:50%;background:#d9ddd5}.win .bar span:nth-child(1){background:#e8b7a3}.win .bar span:nth-child(2){background:#ead7a6}.win .bar span:nth-child(3){background:#b9d3bf}
  .win .bar em{margin-left:14px;font:600 22px/1 ${SANS};font-style:normal;color:#7d887f}
  .win .view{position:relative;width:1000px;height:600px;overflow:hidden}.win .view img{position:absolute;left:0;top:0;transform-origin:0 0}
  .label{position:absolute;left:0;top:0;background:${C.green};color:${C.cup};font:700 28px/1 ${SANS};padding:14px 26px;border-radius:999px;opacity:0;white-space:nowrap}
  .foot{position:absolute;left:0;right:0;top:1688px;text-align:center}
  .foot b{display:block;font:700 40px/1 ${SANS};color:${C.green}}
  .foot span{display:block;margin-top:14px;font:600 28px/1 ${SANS};color:${C.muted}}
  .fade{position:absolute;inset:0;background:${C.bg};pointer-events:none}`);
}

async function video(browser: Browser, scene: Scene, file: string) {
  const htmlFile = join(WORK, `${scene.name}.html`); writeFileSync(htmlFile, stageHtml(scene));
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlFile).href);
  await page.evaluate('document.fonts.ready');
  const fps = 30, total = Math.round(scene.duration * fps);
  if (!coversOnly) {
    const mp4 = join(OUT, `${file}.mp4`);
    const ff = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
      '-vf', 'scale=1080:1920:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-level', '4.1',
      '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(fps), '-movflags', '+faststart', '-an', mp4], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise<number>(r => ff.on('exit', c => r(c ?? 1)));
    const write = (b: Buffer) => new Promise<void>(r => { if (ff.stdin.write(b)) r(); else ff.stdin.once('drain', () => r()); });
    for (let i = 0; i < total; i++) {
      await page.evaluate(`renderAt(${(i / fps).toFixed(4)})`);
      await write(await page.screenshot({ type: 'png' }));
  }
  ff.stdin.end();
  if (await done !== 0) throw new Error(`${file}: ffmpeg başarısız.`);
  }
  // Cover: the grid's central 1080×1350 of one settled frame, with the cover title in the caption's place.
  await page.evaluate(`renderAt(${scene.cover.t})`);
  await page.evaluate(`coverMode(${JSON.stringify(scene.cover.title)}, ${JSON.stringify(scene.cover.sub)})`);
  await page.evaluate(`renderAt(${scene.cover.t})`);
  const cover = await page.screenshot({ clip: { x: 0, y: 285, width: 1080, height: 1350 } });
  writeFileSync(join(WORK, `${file}-kapak.png`), cover);
  await jpeg(cover, join(OUT, `${file}-kapak.jpg`));
  await page.close();
  console.log(`  ${file}.mp4 · ${scene.duration.toFixed(1)} sn`);
}

// Phone placements on the 1080×1920 stage.
const PH = { x: 540, y: 1078 };                      // alone, centred under the caption
const LEFT = { x: 292, y: 1110, s: .8 }, RIGHT = { x: 788, y: 1110, s: .8 };

type Box = { x: number; y: number; width: number; height: number };
const boxes = (clip: string) => JSON.parse(readFileSync(join(REC, clip, existsSync(join(REC, clip, 'kutular.json')) ? 'kutular.json' : 'kasa-kutular.json'), 'utf8')) as Record<string, Box | null>;
function scenes(): Scene[] {
  const list: Scene[] = [];
  {
    const m = timeline('siparis').marks, end = Math.min(15, m.end);
    list.push({ name: 'siparis', duration: end, cover: { t: m.menuReady + 0.9, title: 'Masadan QR ile <em>sipariş</em>', sub: 'Garson beklemeden, kendi telefonundan' },
      captions: [
        { from: 0, to: m.menu, text: 'Masadaki QR’ı okutun' },
        { from: m.menu + .1, to: m.product, text: 'Fotoğraflı menü<br>telefonda açılır' },
        { from: m.product + .05, to: m.cart, text: 'Ürünü seçin,<br><em>sepete ekleyin</em>' },
        { from: m.cart + .05, to: m.done, text: 'Siparişi gönderin' },
        { from: m.done + .05, to: end + 1, text: 'Siparişiniz alındı.<br><em>Afiyet olsun!</em>', last: true },
      ],
      phones: [{ id: 'g', clip: 'siparis', keys: [{ t: 0, ...PH, s: 1 }] }] });
  }
  {
    const m = timeline('garson').marks, end = Math.min(15, m.end);
    const split = m.called + .4, chip = boxes('garson').chip ?? { x: 16, y: 66, width: 260, height: 40 };
    list.push({ name: 'garson', duration: end, cover: { t: m.answer - .3, title: 'Garsonu <em>tek dokunuşla</em> çağırın', sub: 'Çağrı garsonun telefonuna düşer' },
      captions: [
        { from: 0, to: m.call, text: 'Bir şey mi lazım?' },
        { from: m.call + .05, to: split, text: '“Garson çağır”a<br>dokunun' },
        { from: split + .05, to: m.answer, text: 'Çağrı garsonun<br><em>telefonuna düşer</em>' },
        { from: m.answer + .05, to: end + 1, text: 'Garson gelir,<br>çağrı kapanır', last: true },
      ],
      phones: [
        { id: 'g', clip: 'garson', label: 'Müşteri', labelFrom: split + .3, keys: [{ t: 0, ...PH, s: 1 }, { t: split, ...PH, s: 1 }, { t: split + .8, ...LEFT }] },
        { id: 'w', clip: 'garson-personel', label: 'Garson', labelFrom: split + .5, keys: [{ t: 0, x: 1400, y: RIGHT.y, s: RIGHT.s, o: 0 }, { t: split, x: 1400, y: RIGHT.y, s: RIGHT.s, o: 0 }, { t: split + .8, ...RIGHT, o: 1 }] },
      ],
      zooms: [{ clip: 'garson-personel', screen: { w: 390, h: 844 }, width: 720, region: { x: chip.x - 8, y: chip.y - 8, w: chip.width + 16, h: chip.height + 16 },
        // Frozen just before the waiter's tap (the call leaves the list at once), then it fades out.
        freeze: (m.tap ?? m.answer + .4) - .03,
        keys: [{ t: 0, x: 540, y: 1468, s: .85, o: 0 }, { t: split + 1.1, x: 540, y: 1468, s: .85, o: 0 }, { t: split + 1.6, x: 540, y: 1468, s: 1, o: 1 },
          { t: (m.tap ?? m.answer + .4) + .1, x: 540, y: 1468, s: 1, o: 1 }, { t: (m.tap ?? m.answer + .4) + .5, x: 540, y: 1468, s: .92, o: 0 }] }] });
  }
  {
    const m = timeline('hesap').marks, end = Math.min(15, m.end);
    const sw = m.asked + .5, W = { x: 540, y: 862 }, R0 = { x: 236, y: 0, w: 1044 };
    // The counter's window: the whole screen first, then closer on the call, then on the table's tile.
    const b = boxes('hesap');
    const around = (box: Box | null, fallback: { x: number; y: number }, w = 600) => box
      ? { x: Math.max(0, Math.min(1280 - w, box.x + box.width / 2 - w / 2)), y: Math.max(0, Math.min(800 - w * .6, box.y + box.height / 2 - w * .3)), w } : { ...fallback, w };
    const chip = around(b.chip ? { ...b.chip, x: b.chip.x + 150 } : null, { x: 262, y: 0 }), tile = around(b.tile, { x: 640, y: 300 });
    list.push({ name: 'hesap', duration: end, cover: { t: m.choose - .15, title: 'Hesabı <em>masadan</em> isteyin', sub: 'Nakit mi, kart mı? Kasa önceden bilir' },
      captions: [
        { from: 0, to: m.ask, text: 'Kalkmaya hazır mısınız?' },
        { from: m.ask + .05, to: m.choose, text: '“Hesabı iste”ye<br>dokunun' },
        { from: m.choose + .05, to: sw, text: 'Nakit mi, kart mı?<br><em>Seçin, yeter</em>' },
        { from: sw + .05, to: sw + 3.8, text: 'İstek kasaya<br><em>anında düşer</em>' },
        { from: sw + 3.85, to: end + 1, text: 'Kart dediyseniz<br>garson POS’la gelir', last: true },
      ],
      phones: [{ id: 'g', clip: 'hesap', keys: [{ t: 0, ...PH, s: 1 }, { t: sw, ...PH, s: 1 }, { t: sw + .9, x: 214, y: 1394, s: .45 }] }],
      window: { clip: 'hesap-kasa', title: 'Kasa ekranı', keys: [{ t: 0, ...W, s: .9, o: 0 }, { t: sw + .2, ...W, s: .9, o: 0 }, { t: sw + 1, ...W, s: 1, o: 1 }],
        regions: [{ t: 0, ...R0 }, { t: sw + 1.6, ...R0 }, { t: sw + 2.6, ...chip }, { t: sw + 4.4, ...chip }, { t: sw + 5.4, ...tile }] } });
  }
  return list;
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const parts = [['1', '01-marka-logo', 0], ['2', '02-marka-mola', 1080], ['3', '03-marka-slogan', 2160]] as const;
    const tiles = parts.filter(([n]) => wanted(n));
    if (tiles.length) await render(browser, bannerHtml(), 3240, 1350, 'banner', tiles.map(([, file, x]) => ({ x, file })));
    if (wanted('5')) await render(browser, menuPhotoHtml(), 1080, 1350, '05-menu-fotografli');
    if (wanted('7')) {
      if (!existsSync(join(REC, 'ekran', 'menu-ust.png'))) throw new Error('Önce kayıt: npx tsx scripts/sosyal/blok1-kayit.ts ekran');
      await render(browser, phoneShotHtml(), 1080, 1350, '07-qr-menu-telefonda');
    }
    if (wanted('9')) await render(browser, trialHtml(), 1080, 1350, '09-30-gun-ucretsiz');
    const files: Record<string, string> = { siparis: '04-qr-siparis', garson: '06-garson-cagir', hesap: '08-hesap-iste' };
    for (const s of scenes()) if (wanted(s.name)) await video(browser, s, files[s.name]);
  } finally { await browser.close(); }
}
await main();
