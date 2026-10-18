/*
 * YouTube pilot 1 "QR menü ve QR sipariş": the 1920×1080 video, its thumbnail and description, made from the recordings of
 * scripts/sosyal/youtube-qr-kayit.ts. No voice-over: captions and the background music of scripts/sosyal/muzik.py (canli-uzun).
 *
 *   npx tsx scripts/sosyal/youtube-kurgu.ts                everything (scenes → video → music → kapak.jpg, aciklama.txt)
 *   npx tsx scripts/sosyal/youtube-kurgu.ts b1 c2          only these scenes again (then the video is joined again)
 *   npx tsx scripts/sosyal/youtube-kurgu.ts --kare         one still per scene (contact sheet), no video
 *   npx tsx scripts/sosyal/youtube-kurgu.ts --kapak        only the thumbnail and the description
 *   SOSYAL_CIKTI=<klasör> …                                another output folder
 *
 * Every scene is an HTML stage (1920×1080) drawn for every frame at 30 fps from the recorded frames (phone mockups, the
 * staff screens as windows or full screen with a moving camera, zoom callouts, captions, the chapter label and step counter),
 * each frame a screenshot piped to ffmpeg; scenes are rendered side by side in a few Chrome pages, then joined (same
 * encoding, stream copy) and given the music: H.264 High, yuv420p BT.709, AAC 48 kHz stereo, music at about -20 LUFS.
 * Tone (owner, 18 Ekim): plain and informative; captions say what happens, no sales lines.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import sharp from 'sharp';

const ROOT = resolve('.');
const REC = join(ROOT, '.local', 'sosyal', 'youtube', 'kayit');
const WORK = join(ROOT, '.local', 'sosyal', 'youtube', 'kurgu');
const OUT = resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola YouTube', '01 QR menü ve QR sipariş'));
const FFMPEG = process.env.FFMPEG ?? 'C:\\FFmpeg\\bin\\ffmpeg.exe';
const args = process.argv.slice(2), only = args.filter(a => !a.startsWith('--'));
const stills = args.includes('--kare'), coverOnly = args.includes('--kapak');
const FPS = 30, W = 1920, H = 1080, PARALLEL = Number(process.env.PARALEL ?? 3);
mkdirSync(WORK, { recursive: true }); mkdirSync(OUT, { recursive: true });

// ---------- Brand (site/src/assets/site.css), as scripts/sosyal/blok1-kurgu.ts ----------
const C = { green900: '#163328', green: '#234c3e', green700: '#2c5c4a', green500: '#4f8566', green200: '#cfe0d3', green100: '#e6efe7', cream: '#e6dfd1', bg: '#ece6da', paper: '#f6f1e8', ink: '#1f3128', body: '#33463c', muted: '#5a6a61', line: '#ddd5c6', accent: '#b96844', accentSoft: '#f6e6dc', cup: '#f3ebdd' };
const SERIF = `Georgia, 'Times New Roman', serif`, SANS = `'Segoe UI', system-ui, Arial, sans-serif`;
const cupPaths = `<path d="M10 2v2"/><path d="M14 2v2"/><path d="M6 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/>`;
/** The app icon (public/favicon.svg): green rounded square, cream cup. */
const mark = (size: number) => `<svg width="${size}" height="${size}" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="${C.green}"/><g transform="translate(41.6 45.2) scale(7.2)" fill="none" stroke="${C.cup}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${cupPaths}</g></svg>`;
const img = (file: string) => pathToFileURL(file).href;
const base = (w: number, h: number, body: string, css = '') => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}html,body{width:${w}px;height:${h}px;overflow:hidden}
  body{font-family:${SANS};-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
  .serif{font-family:${SERIF}}${css}</style></head><body>${body}</body></html>`;

// ---------- Recordings ----------
type Box = { x: number; y: number; width: number; height: number };
type Meta = { size: { width: number; height: number; scale: number }; frames: { file: string; t: number }[]; marks: Record<string, number>; boxes?: Record<string, Box | null> };
const metas = new Map<string, Meta>();
const meta = (clip: string) => { if (!metas.has(clip)) metas.set(clip, JSON.parse(readFileSync(join(REC, clip, 'meta.json'), 'utf8')) as Meta); return metas.get(clip)!; };
/** Mark times relative to the clip's start. */
const marks = (clip: string) => { const m = meta(clip); return Object.fromEntries(Object.entries(m.marks).map(([k, v]) => [k, v - m.marks.start])) as Record<string, number>; };
const box = (clip: string, name: string, fallback: Box): Box => meta(clip).boxes?.[name] ?? fallback;
const frames = (clip: string) => { const m = meta(clip); return m.frames.map(f => ({ src: img(join(REC, clip, f.file)), t: f.t - m.marks.start })); };

// ---------- Scenes ----------
type Key = { t: number; x: number; y: number; s?: number; o?: number };
/** [scene time, clip time] points; straight lines between them, slope 1 outside. Two points with the same clip time hold a frame. */
type TimeMap = [number, number][];
type Cam = { t: number; x: number; y: number; w: number };
type Layer =
  | { kind: 'phone'; clip: string; h: number; keys: Key[]; map: TimeMap }
  | { kind: 'screen'; clip: string; w: number; h: number; keys: Key[]; map: TimeMap; cam: Cam[]; title?: string; rings?: { box: Box; from: number; to: number }[] }
  | { kind: 'zoom'; clip: string; box: Box; width: number; keys: Key[]; map: TimeMap }
  | { kind: 'image'; src: string; w: number; keys: Key[]; shadow?: boolean }
  | { kind: 'html'; html: string; keys: Key[] };
type Caption = { from: number; to: number; text: string; step?: number };
type Scene = {
  name: string; duration: number; chapter?: number; captions?: Caption[]; capPos?: 'side' | 'bottom' | 'overlay'; steps?: number;
  layers?: Layer[]; card?: string; split?: { title: string; left: string; right: string; leftTone?: 'off' | 'on'; rightTone?: 'off' | 'on' }; place?: string;
  /** Chapter marker for the description. */
  toc?: string;
};
const CHAPTERS = ['Misafir gözünden', 'İşletme tarafı', 'Ayarlar'];

function stageHtml(scene: Scene) {
  const data = {
    duration: scene.duration, captions: scene.captions ?? [], capPos: scene.capPos ?? 'bottom', steps: scene.steps ?? 0,
    layers: (scene.layers ?? []).map(l => 'clip' in l ? { ...l, frames: frames(l.clip), size: meta(l.clip).size, end: marks(l.clip).end } : l),
  };
  const chapter = scene.chapter ? `<div class="corner">${mark(34)}<span><b>${scene.chapter}</b> · ${CHAPTERS[scene.chapter - 1]}</span></div>` : '';
  const split = scene.split ? `<div class="split"><div class="divider"></div><h2 class="serif">${scene.split.title}</h2>
    <span class="half-label ${scene.split.leftTone ?? 'off'}" style="left:480px">${scene.split.left}</span><span class="half-label ${scene.split.rightTone ?? 'on'}" style="left:1440px">${scene.split.right}</span></div>` : '';
  return base(W, H, `
  <div class="bg${scene.card ? ' card-bg' : ''}"></div>
  ${scene.card ?? ''}
  ${split}
  <div id="layers">${data.layers.map((l, i) => l.kind === 'phone' ? `<div class="phone L" id="l${i}"><div class="screen"><img></div></div>`
    : l.kind === 'screen' ? `<div class="win L${l.w >= W ? ' full' : ''}" id="l${i}">${l.title ? `<div class="bar"><span></span><span></span><span></span><em>${l.title}</em></div>` : ''}<div class="view"><img><div class="rings"></div></div></div>`
    : l.kind === 'zoom' ? `<div class="zoom L" id="l${i}"><div class="view"><img></div></div>`
    : l.kind === 'image' ? `<div class="paper L${l.shadow === false ? '' : ' shadow'}" id="l${i}"><img src="${l.src}" style="width:${l.w}px"></div>`
    : `<div class="L" id="l${i}">${l.html}</div>`).join('')}</div>
  ${scene.place ? `<div class="place">${scene.place}</div>` : ''}
  ${chapter}
  <div class="steps" id="steps"></div>
  <div class="cap ${data.capPos}" id="cap"><div></div></div>
  <div class="fade" id="fade"></div>
  <script>
  const D = ${JSON.stringify(data)};
  const ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function key(list, t) {
    if (t <= list[0].t) return list[0];
    for (let i = 1; i < list.length; i++) if (t < list[i].t) { const a = list[i - 1], b = list[i], k = ease((t - a.t) / (b.t - a.t)); const o = { t }; for (const f of Object.keys(b)) if (f !== 't') o[f] = (a[f] ?? 1) + ((b[f] ?? 1) - (a[f] ?? 1)) * k; return o; }
    return list[list.length - 1];
  }
  function mapT(map, t) {
    if (!map.length) return t;
    if (t <= map[0][0]) return map[0][1] - (map[0][0] - t);
    for (let i = 1; i < map.length; i++) if (t < map[i][0]) { const [s0, c0] = map[i - 1], [s1, c1] = map[i]; return c0 + (c1 - c0) * (t - s0) / (s1 - s0); }
    const [s, c] = map[map.length - 1]; return c + (t - s);
  }
  function frameAt(frames, t) { let lo = 0, hi = frames.length - 1; if (t <= frames[0].t) return frames[0].src; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid].t <= t) lo = mid; else hi = mid - 1; } return frames[lo].src; }
  const pending = [];
  function setSrc(el, src) { if (el.getAttribute('src') !== src) { el.setAttribute('src', src); pending.push(el.decode().catch(() => {})); } }
  function place(el, k) { el.style.transform = 'translate(' + (k.x - el.offsetWidth / 2) + 'px,' + (k.y - el.offsetHeight / 2) + 'px) scale(' + (k.s ?? 1) + ')'; el.style.opacity = k.o ?? 1; }
  // Sizes that do not change: set once.
  D.layers.forEach((l, i) => {
    const el = document.getElementById('l' + i);
    if (l.kind === 'phone') { const sw = l.h * 390 / 844, pad = Math.round(sw * .035), r = Math.round(sw * .13);
      el.style.width = (sw + 2 * pad) + 'px'; el.style.height = (l.h + 2 * pad) + 'px'; el.style.padding = pad + 'px'; el.style.borderRadius = r + 'px';
      const s = el.querySelector('.screen'); s.style.width = sw + 'px'; s.style.height = l.h + 'px'; s.style.borderRadius = (r - pad) + 'px'; }
    if (l.kind === 'screen') { el.style.width = l.w + 'px'; const v = el.querySelector('.view'); v.style.width = l.w + 'px'; v.style.height = l.h + 'px'; }
    if (l.kind === 'zoom') { const v = el.querySelector('.view'); v.style.width = l.width + 'px'; v.style.height = (l.width * l.box.height / l.box.width) + 'px'; }
  });
  window.renderAt = async function (t) {
    D.layers.forEach((l, i) => {
      const el = document.getElementById('l' + i), k = key(l.keys, t);
      place(el, k);
      if ((k.o ?? 1) <= 0.001 || !l.frames) return;
      const ct = clamp(mapT(l.map || [], t), 0, l.end - .02), im = el.querySelector('img');
      if (l.kind === 'phone') setSrc(im, frameAt(l.frames, ct));
      if (l.kind === 'screen') {
        const c = key(l.cam, t), z = l.w / c.w;
        im.style.width = (l.size.width * z) + 'px'; im.style.height = (l.size.height * z) + 'px';
        im.style.transform = 'translate(' + (-c.x * z) + 'px,' + (-c.y * z) + 'px)';
        setSrc(im, frameAt(l.frames, ct));
        const rings = el.querySelector('.rings'); let html = '';
        for (const r of l.rings || []) {
          const o = Math.min(clamp((t - r.from) / .35, 0, 1), clamp((r.to - t) / .35, 0, 1)); if (o <= 0) continue;
          const p = 10;
          html += '<i style="opacity:' + o + ';left:' + ((r.box.x - c.x) * z - p) + 'px;top:' + ((r.box.y - c.y) * z - p) + 'px;width:' + (r.box.width * z + 2 * p) + 'px;height:' + (r.box.height * z + 2 * p) + 'px"></i>';
        }
        rings.innerHTML = html;
      }
      if (l.kind === 'zoom') {
        const z = l.width / l.box.width;
        im.style.width = (l.size.width * z) + 'px'; im.style.height = (l.size.height * z) + 'px';
        im.style.transform = 'translate(' + (-l.box.x * z) + 'px,' + (-l.box.y * z) + 'px)';
        setSrc(im, frameAt(l.frames, ct));
      }
    });
    // Captions one after another: each fades and rises in, then fades out before the next.
    const cap = document.getElementById('cap'), c = D.captions.find(c => t >= c.from && t < c.to);
    if (!c) cap.style.opacity = 0;
    else {
      if (cap.dataset.text !== c.text) { cap.firstChild.innerHTML = c.text; cap.dataset.text = c.text; }
      const inK = clamp((t - c.from) / .45, 0, 1), outK = clamp((c.to - t) / .3, 0, 1);
      cap.style.opacity = Math.min(ease(inK), outK);
      cap.style.transform = 'translateY(' + ((1 - ease(inK)) * 18) + 'px)';
    }
    const steps = document.getElementById('steps'), last = [...D.captions].reverse().find(c => c.step && t >= c.from);
    if (D.steps && last) { steps.style.opacity = 1; steps.innerHTML = 'Adım <b>' + last.step + '</b> / ' + D.steps + '<span>' + Array.from({ length: D.steps }, (_, i) => '<i class="' + (i < last.step ? 'on' : '') + '"></i>').join('') + '</span>'; } else steps.style.opacity = 0;
    const f = document.getElementById('fade'); f.style.opacity = t < .35 ? 1 - t / .35 : t > D.duration - .35 ? (t - (D.duration - .35)) / .35 : 0;
    await Promise.all(pending.splice(0));
  };
  </script>`, `
  body{background:${C.bg}}
  .bg{position:absolute;inset:0;background:radial-gradient(60% 55% at 88% 12%,rgba(214,220,200,.9),rgba(214,220,200,0)),radial-gradient(55% 50% at 6% 92%,rgba(246,230,220,.9),rgba(246,230,220,0)),${C.bg}}
  .card-bg{background:radial-gradient(80% 70% at 30% 40%,#2a5848 0%,${C.green} 60%,#1d4134 100%)}
  .L{position:absolute;left:0;top:0;transform-origin:50% 50%;will-change:transform}
  .phone{background:#1c2721;box-shadow:0 50px 90px -40px rgba(22,51,40,.55),0 16px 34px -18px rgba(22,51,40,.35),inset 0 0 0 2px #3a4a41}
  .phone .screen{position:relative;overflow:hidden;background:${C.paper}}
  .phone .screen img{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
  .win{position:absolute;left:0;top:0;background:${C.paper};border-radius:22px;overflow:hidden;box-shadow:0 50px 90px -40px rgba(22,51,40,.5),0 0 0 2px ${C.line};transform-origin:50% 50%}
  .win.full{border-radius:0;box-shadow:none}
  .win .bar{display:flex;align-items:center;gap:9px;height:44px;padding:0 20px;background:${C.cream};border-bottom:2px solid ${C.line}}
  .win .bar span{width:13px;height:13px;border-radius:50%;background:#d9ddd5}.win .bar span:nth-child(1){background:#e8b7a3}.win .bar span:nth-child(2){background:#ead7a6}.win .bar span:nth-child(3){background:#b9d3bf}
  .win .bar em{margin-left:12px;font:600 21px/1 ${SANS};font-style:normal;color:#5f6b63}
  .win .view{position:relative;overflow:hidden}.win .view img{position:absolute;left:0;top:0;transform-origin:0 0}
  .rings{position:absolute;inset:0;pointer-events:none}.rings i{position:absolute;border:5px solid ${C.accent};border-radius:16px;box-shadow:0 0 0 9999px rgba(31,49,40,.16)}
  .zoom{padding:10px;background:${C.paper};border-radius:26px;box-shadow:0 40px 80px -30px rgba(22,51,40,.6),0 0 0 4px ${C.accent}}
  .zoom .view{position:relative;overflow:hidden;border-radius:16px}.zoom .view img{position:absolute;left:0;top:0;transform-origin:0 0}
  .paper{background:#fff;padding:0;border-radius:6px}.paper.shadow{box-shadow:0 40px 80px -30px rgba(22,51,40,.55),0 0 0 1px ${C.line}}.paper img{display:block;border-radius:6px}
  .corner{position:absolute;left:34px;top:26px;display:flex;align-items:center;gap:14px;padding:8px 20px 8px 8px;border-radius:999px;background:rgba(246,241,232,.92);box-shadow:0 8px 22px -12px rgba(22,51,40,.45);font:500 22px/1 ${SANS};color:${C.muted};z-index:5}
  .corner svg{border-radius:10px}.corner b{color:${C.green};font-weight:700}
  .steps{position:absolute;right:34px;top:26px;display:flex;align-items:center;gap:14px;padding:12px 22px;border-radius:999px;background:rgba(246,241,232,.92);box-shadow:0 8px 22px -12px rgba(22,51,40,.45);font:500 21px/1 ${SANS};color:${C.muted};opacity:0;z-index:5}
  .steps b{color:${C.green};font-weight:700}.steps span{display:flex;gap:6px}.steps i{width:9px;height:9px;border-radius:50%;background:${C.line}}.steps i.on{background:${C.green500}}
  .place{position:absolute;left:50%;top:26px;transform:translateX(-50%);padding:12px 26px;border-radius:999px;background:${C.green};color:${C.cup};font:600 23px/1 ${SANS};white-space:nowrap;z-index:5;box-shadow:0 10px 26px -12px rgba(22,51,40,.6)}
  .cap{position:absolute;opacity:0;z-index:6;color:${C.green900}}
  .cap em{font-style:normal;color:${C.accent}}
  .cap.side{left:1010px;width:820px;top:300px;height:480px;display:flex;align-items:center;font:400 60px/1.16 ${SERIF};letter-spacing:-.015em}
  .cap.bottom{left:0;right:0;top:948px;height:110px;display:flex;align-items:center;justify-content:center;text-align:center;font:400 46px/1.15 ${SERIF};letter-spacing:-.01em}
  .cap.overlay{left:0;right:0;bottom:44px;display:flex;justify-content:center}
  .cap.overlay div{padding:22px 40px;border-radius:26px;background:rgba(246,241,232,.96);box-shadow:0 24px 50px -20px rgba(22,51,40,.55),0 0 0 2px ${C.line};font:400 44px/1.15 ${SERIF};white-space:nowrap}
  .split h2{position:absolute;left:0;right:0;top:92px;text-align:center;font-weight:400;font-size:40px;color:${C.green900};letter-spacing:-.01em}
  .split .divider{position:absolute;left:959px;top:150px;width:2px;height:770px;background:${C.line}}
  .half-label{position:absolute;top:150px;transform:translateX(-50%);padding:10px 26px;border-radius:999px;font:700 24px/1 ${SANS};letter-spacing:.06em;text-transform:uppercase;z-index:4}
  .half-label.off{background:${C.cream};color:${C.muted};box-shadow:inset 0 0 0 2px ${C.line}}
  .half-label.on{background:${C.green};color:${C.cup}}
  .badge{padding:10px 20px;border-radius:999px;background:${C.green900};color:${C.cup};font:700 24px/1 ${SANS};white-space:nowrap}
  .fade{position:absolute;inset:0;background:${C.bg};pointer-events:none;z-index:9}
  ${scene.card ? cardCss : ''}`);
}

// ---------- Cards ----------
const cardCss = `
  .card{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding-left:200px;color:${C.cup}}
  .card .eyebrow{font:700 26px/1 ${SANS};letter-spacing:.3em;color:rgba(243,235,221,.75);display:flex;align-items:center;gap:18px}
  .card .eyebrow::before{content:"";width:44px;height:3px;background:${C.accent};border-radius:2px}
  .card h1{margin-top:30px;font:400 112px/1.04 ${SERIF};letter-spacing:-.025em}
  .card p{margin-top:28px;font:400 34px/1.35 ${SANS};color:rgba(243,235,221,.82);max-width:1250px}
  .card ol{list-style:none;margin-top:54px;display:flex;gap:22px}
  .card li{display:flex;align-items:center;gap:14px;padding:14px 26px 14px 14px;border-radius:999px;background:rgba(243,235,221,.1);font:600 28px/1 ${SANS}}
  .card li span{width:42px;height:42px;border-radius:50%;background:${C.cup};color:${C.green};display:grid;place-items:center;font:700 22px/1 ${SANS}}
  .brand{position:absolute;left:200px;bottom:84px;display:flex;align-items:center;gap:18px;font:400 44px/1 ${SERIF};color:${C.cup}}
  .brand svg{border-radius:14px;box-shadow:0 0 0 2px rgba(243,235,221,.3)}.card .brand i{font-style:normal;color:#d9875f}
  .card .num{position:absolute;right:170px;top:50%;transform:translateY(-54%);font:400 520px/1 ${SERIF};color:rgba(243,235,221,.08)}
  .end{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:${C.cup};text-align:center}
  .end svg{border-radius:40px;box-shadow:0 0 0 3px rgba(243,235,221,.25)}
  .end .word{margin-top:34px;font:400 120px/1 ${SERIF};letter-spacing:-.03em}.end .word i{font-style:normal;color:#d9875f}
  .end .sub{margin-top:22px;font:700 24px/1 ${SANS};letter-spacing:.3em;color:rgba(207,224,211,.85)}
  .end .site{margin-top:64px;font:600 46px/1 ${SANS};color:${C.cup}}
  .end .trial{margin-top:20px;font:400 28px/1 ${SANS};color:rgba(243,235,221,.7)}`;
const brandRow = `<div class="brand">${mark(58)}<span>mola<i>.</i></span></div>`;
const introCard = `<div class="card"><div class="eyebrow">MOLA · ADİSYON VE QR MENÜ</div><h1>QR menü ve QR sipariş</h1>
  <p>Misafirin telefonundan verilen sipariş; garson, kasa ve mutfak ekranları; bunları belirleyen ayarlar.</p>
  <ol>${CHAPTERS.map((c, i) => `<li><span>${i + 1}</span>${c}</li>`).join('')}</ol></div>${brandRow}`;
const chapterCard = (n: number, sub: string) => `<div class="card"><div class="num">${n}</div><div class="eyebrow">BÖLÜM ${n}</div><h1>${CHAPTERS[n - 1]}</h1><p>${sub}</p></div>${brandRow}`;
const endCard = `<div class="end">${mark(150)}<div class="word">mola<i>.</i></div><div class="sub">ADİSYON · QR MENÜ</div><div class="site">molayazilim.com.tr</div><div class="trial">30 gün ücretsiz deneme</div></div>`;

// ---------- Helpers for the scene list ----------
/** A clip played at its own speed from `from` (clip time) at scene time `at`. */
const play = (from: number, at = 0): TimeMap => [[at, from]];
/** Segments of a clip one after another: [clip from, clip to, speed]. Returns the map and a clip→scene time converter. */
function segments(list: [number, number, number?][], start = 0) {
  const map: TimeMap = []; let s = start;
  const parts: { s0: number; s1: number; c0: number; c1: number }[] = [];
  for (const [c0, c1, speed = 1] of list) { const d = (c1 - c0) / speed; map.push([s, c0], [s + d - 0.0005, c1]); parts.push({ s0: s, s1: s + d, c0, c1 }); s += d; }
  const at = (c: number) => { for (const p of parts) if (c >= p.c0 && c <= p.c1) return p.s0 + (c - p.c0) * (p.s1 - p.s0) / (p.c1 - p.c0); throw new Error(`${c} kesilen bölümde`); };
  return { map, at, end: s };
}
const still = (x: number, y: number, s = 1, o = 1): Key[] => [{ t: 0, x, y, s, o }];
/** Fades a layer in at `t` (from slightly smaller) and optionally out at `out`. */
const appear = (x: number, y: number, t: number, out?: number, s = 1): Key[] => [{ t: 0, x, y, s: s * .94, o: 0 }, { t, x, y, s: s * .94, o: 0 }, { t: t + .45, x, y, s, o: 1 },
  ...(out !== undefined ? [{ t: out, x, y, s, o: 1 }, { t: out + .35, x, y, s: s * .96, o: 0 }] : [])];
/** A camera region of the 1280×800 screen around a box, `w` wide, with the stage view's aspect. */
function around(b: Box, w: number, aspect = 16 / 9, dx = 0, dy = 0) {
  const h = w / aspect;
  return { x: Math.max(0, Math.min(1280 - w, b.x + b.width / 2 - w / 2 + dx)), y: Math.max(0, Math.min(800 - h, b.y + b.height / 2 - h / 2 + dy)), w };
}
const FULL = { x: 0, y: 40, w: 1280 };          // the whole 1280×800 screen on 1920×1080 (16:9 cuts 40 px top and bottom)
const fullCam = (...list: [number, { x: number; y: number; w: number }][]): Cam[] => list.map(([t, c]) => ({ t, ...c }));
const union = (a: Box, b: Box): Box => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }; };
const pad = (b: Box, p: number): Box => ({ x: b.x - p, y: b.y - p, width: b.width + 2 * p, height: b.height + 2 * p });

function scenes(): Scene[] {
  const list: Scene[] = [];
  // YouTube chapters start at 0:00 and last at least 10 s: the short intro and chapter cards belong to the part after them.
  list.push({ name: 'a0-giris', duration: 6.5, card: introCard, toc: `Giriş · ${CHAPTERS[0]}` });

  // ===== Bölüm 1: the guest's phone alone (clip "ana"), the wait for the kitchen cut out =====
  list.push({ name: 'b0-bolum', duration: 3.6, card: chapterCard(1, 'Masadaki QR koddan hesabın istenmesine kadar misafirin telefonu.') });
  {
    const m = marks('ana');
    const seg = segments([[0.2, m.top + 2.2], [m.call - 1.4, m.end - .3]]);
    const at = seg.at, P = { x: 600, y: 548 };
    const chg = box('ana', 'change', { x: 35, y: 327, width: 157, height: 36 });
    list.push({ name: 'b1-misafir', chapter: 1, duration: seg.end, capPos: 'side', steps: 8,
      layers: [
        { kind: 'phone', clip: 'ana', h: 920, keys: still(P.x, P.y), map: seg.map },
        { kind: 'zoom', clip: 'ana', box: pad(chg, 8), width: 560, map: seg.map, keys: appear(1420, 760, at(m.track) + 1.2, at(m.change) + .2) },
      ],
      captions: [
        { from: 0, to: at(m.menu) + .4, step: 1, text: 'Misafir masadaki QR kodu<br>telefonun kamerasıyla okutur.' },
        { from: at(m.menu) + .5, to: at(m.categories), step: 2, text: 'Menü tarayıcıda açılır.<br>Uygulama yüklenmez.' },
        { from: at(m.categories), to: at(m.search), step: 2, text: 'Ürünler kategorilere ayrılır,<br>fotoğraflarıyla listelenir.' },
        { from: at(m.search), to: at(m.english), step: 3, text: 'Arama kutusu ürünü<br>adından ya da kodundan bulur.' },
        { from: at(m.english), to: at(m.product), step: 3, text: '<em>EN</em> menüyü İngilizceye çevirir,<br><em>TR</em> Türkçeye döndürür.' },
        { from: at(m.product), to: at(m.add), step: 4, text: 'Ürün açılır, seçenek belirlenir:<br>şeker tercihi “Orta”.' },
        { from: at(m.add), to: at(m.send), step: 4, text: 'Ürün sepete eklenir.' },
        { from: at(m.send), to: at(m.track), step: 5, text: 'Sipariş gönderilir.<br>Ekranda sipariş numarası görünür.' },
        { from: at(m.track), to: at(m.change), step: 6, text: '“Siparişlerim” siparişin durumunu<br>ve masanın hesabını gösterir.' },
        { from: at(m.change), to: at(m.save) + .2, step: 6, text: 'Değiştirme süresi içinde<br>sipariş değiştirilebilir: adet 2.' },
        { from: at(m.save) + .3, to: at(m.call), step: 6, text: 'Bu süre bir işletme ayarıdır;<br>3. bölümde gösterilir.' },
        { from: at(m.call), to: at(m.bill), step: 7, text: '“Garson çağır” garsonun<br>telefonuna bildirim gönderir.' },
        { from: at(m.bill), to: seg.end + 1, step: 8, text: '“Hesabı iste”: misafir ödeme<br>şeklini seçer, Nakit ya da Kart.' },
      ] });
  }

  // ===== Bölüm 2: the same moments with the staff screens =====
  list.push({ name: 'c0-bolum', duration: 3.6, card: chapterCard(2, 'Aynı sipariş, çağrı ve hesap isteği garson, mutfak ve kasa ekranlarında.'), toc: CHAPTERS[1] });
  {
    const m = marks('ana'), G = { x: 330, y: 548 }, PH = 760, LY = 112;
    const guest = (map: TimeMap): Layer => ({ kind: 'phone', clip: 'ana', h: PH, keys: still(G.x, G.y), map });
    const label = (text: string, x: number, y: number, from = 0): Layer => ({ kind: 'html', html: `<span class="badge">${text}</span>`, keys: appear(x, y, from) });
    // 2.1 The order on the waiter's phone, 2.2 the change reaches it too.
    {
      const from = m.send - 1.2, to = m.top + 1.8, map = play(from), d = to - from, at = (c: number) => c - from;
      const tile = box('ana-garson', 'tile', { x: 17, y: 191, width: 113, height: 88 });
      list.push({ name: 'c1-garson-siparis', chapter: 2, duration: d, steps: 5, layers: [
        guest(map), label('Misafir', G.x, LY, .2),
        { kind: 'phone', clip: 'ana-garson', h: PH, keys: still(880, 548), map }, label('Garson telefonu', 880, LY, .2),
        { kind: 'zoom', clip: 'ana-garson', box: pad(tile, 10), width: 420, map, keys: appear(1500, 470, at(m.waiterOrder ?? m.sent + .8) + .3) },
      ], captions: [
        { from: 0, to: at(m.change), step: 1, text: 'Gönderilen sipariş garsonun telefonunda<br>masanın kartında “Yeni sipariş” olarak görünür.' },
        { from: at(m.change), to: d + 1, step: 2, text: 'Misafirin değişikliği (adet 2)<br>garsonun ekranına da yansır.' },
      ] });
    }
    // 2.3 The kitchen gets it when the change window ends (the wait shown 6× faster).
    {
      const from = m.top - .5, fastFrom = m.top + 2, fastTo = m.kitchen - 1.8, to = m.kitchen + 5.5;
      const seg = segments([[from, fastFrom], [fastFrom, fastTo, 6], [fastTo, to]]);
      const ticket = box('ana-mutfak', 'ticket', { x: 31, y: 149, width: 379, height: 297 });
      list.push({ name: 'c2-mutfak', chapter: 2, duration: seg.end, steps: 5, layers: [
        guest(seg.map), label('Misafir', G.x, LY, .2),
        { kind: 'screen', clip: 'ana-mutfak', w: 1180, h: 680, keys: still(1290, 500), map: seg.map, title: 'Mutfak ekranı', cam: fullCam([0, { x: 0, y: 40, w: 1180 }]),
          rings: [{ box: ticket, from: seg.at(m.kitchen) + .3, to: seg.end + 1 }] },
        { kind: 'html', html: `<span class="badge">6× hızlı</span>`, keys: [{ t: 0, x: 1290, y: 880, o: 0 }, { t: seg.at(fastFrom), x: 1290, y: 880, o: 0 }, { t: seg.at(fastFrom) + .3, x: 1290, y: 880, o: 1 }, { t: seg.at(fastTo) - .3, x: 1290, y: 880, o: 1 }, { t: seg.at(fastTo), x: 1290, y: 880, o: 0 }] },
      ], captions: [
        { from: 0, to: seg.at(m.kitchen), step: 3, text: 'Mutfak ekranı siparişi<br>değiştirme süresi bitince alır.' },
        { from: seg.at(m.kitchen), to: seg.end + 1, step: 3, text: 'Sipariş “Yeni sipariş” sütununa düşer:<br>masa, adet ve şeker tercihiyle.' },
      ] });
    }
    // 2.4 Garson çağır.
    {
      const from = m.call - 1.2, to = m.answered + 2.2, map = play(from), d = to - from, at = (c: number) => c - from;
      const chip = box('ana-garson', 'chip', { x: 17, y: 66, width: 257, height: 42 });
      list.push({ name: 'c3-cagri', chapter: 2, duration: d, steps: 5, layers: [
        guest(map), label('Misafir', G.x, LY, .2),
        { kind: 'phone', clip: 'ana-garson', h: PH, keys: still(880, 548), map }, label('Garson telefonu', 880, LY, .2),
        { kind: 'zoom', clip: 'ana-garson', box: pad(chip, 8), width: 600, map: [[0, from], [at(m.answer) - .05, m.answer - .05], [d + 5, m.answer - .05]], keys: appear(1500, 470, at(m.waiterSees) + .1, at(m.answer) + .2) },
      ], captions: [
        { from: 0, to: at(m.answer), step: 4, text: 'Çağrı garsonun telefonunda<br>masa adıyla en üstte görünür.' },
        { from: at(m.answer), to: d + 1, step: 4, text: 'Garson ilgilenince çağrıyı kapatır;<br>misafirin düğmesi eski hâline döner.' },
      ] });
    }
    // 2.5 Hesabı iste → the counter.
    {
      const from = m.bill - .8, to = m.end - .3, map = play(from), d = to - from, at = (c: number) => c - from;
      const chip = box('ana-kasa', 'chip', { x: 280, y: 108, width: 301, height: 36 });
      const tile = box('ana-kasa', 'tile', { x: 765, y: 332, width: 154, height: 136 });
      list.push({ name: 'c4-hesap', chapter: 2, duration: d, steps: 5, layers: [
        guest(map), label('Misafir', G.x, LY, .2),
        { kind: 'screen', clip: 'ana-kasa', w: 1180, h: 680, keys: still(1290, 500), map, title: 'Kasa ekranı', cam: fullCam([0, { x: 0, y: 40, w: 1280 }], [at(m.kasaSees) + .6, { x: 0, y: 40, w: 1280 }], [at(m.kasaSees) + 1.8, { x: 230, y: 70, w: 900 }]),
          rings: [{ box: chip, from: at(m.kasaSees) + 1.6, to: d + 1 }, { box: tile, from: at(m.kasaSees) + 1.9, to: d + 1 }] },
      ], captions: [
        { from: 0, to: at(m.kasaSees) + .4, step: 5, text: 'Misafir hesabı ister ve<br>ödeme şeklini seçer.' },
        { from: at(m.kasaSees) + .4, to: d + 1, step: 5, text: 'İstek kasa ekranına düşer;<br>ödeme şekli “Kart” yanında yazar.' },
      ] });
    }
  }

  // ===== Bölüm 3: the owner's settings: where (full screen), then the effect (split, before | after) =====
  list.push({ name: 'd0-bolum', duration: 3.6, card: chapterCard(3, 'QR siparişini etkileyen ayarlar: nerede oldukları, açıp kapatmak ve etkileri.'), toc: `${CHAPTERS[2]}: QR siparişlerini durdurma` });
  const full = (clip: string, keysCam: Cam[], rings: { box: Box; from: number; to: number }[], d: number): Layer =>
    ({ kind: 'screen', clip, w: W, h: H, keys: still(W / 2, H / 2), map: play(0), cam: keysCam, rings });
  // A. QR siparişlerini durdur (sidebar card)
  {
    const m = marks('ayar-qr'), card = box('ayar-qr', 'card', { x: 23, y: 119, width: 195, height: 68 }), dialog = box('ayar-qr', 'dialog', { x: 410, y: 283, width: 460, height: 233 });
    const closed = box('ayar-qr', 'cardClosed', card), d = m.end - .2;
    const near = around(card, 560, 16 / 9, 120, 90), mid = around(dialog, 900);
    list.push({ name: 'd1-qr-yer', chapter: 3, duration: d, capPos: 'overlay', place: 'Kenar çubuğu · “QR siparişleri” kartı',
      layers: [full('ayar-qr', fullCam([0, FULL], [m.card - .2, FULL], [m.card + 1, near], [m.stop + .6, near], [m.confirm - .3, mid], [m.stopped + .2, mid], [m.stopped + 1.2, near]),
        [{ box: card, from: m.card + 1, to: m.stop + .3 }, { box: pad(dialog, -2), from: m.confirm - .2, to: m.stopped }, { box: closed, from: m.stopped + 1.3, to: m.reopen }], d)],
      captions: [
        { from: .3, to: m.stop + .2, text: 'Kenar çubuğundaki kart QR siparişlerinin durumunu gösterir.' },
        { from: m.stop + .3, to: m.stopped + .6, text: '“Durdur”: QR siparişleri geçici olarak kapatılır.' },
        { from: m.stopped + .7, to: m.reopen, text: 'Kart “kapalı” gösterir; kimin durdurduğu da yazar.' },
        { from: m.reopen, to: d + 1, text: '“Siparişleri aç” tek dokunuşla yeniden açar.' },
      ] });
    const a = marks('qr-acik'), b = marks('qr-durdu'), off = a.product - b.product;
    const notice = union(box('qr-durdu', 'notice', { x: 31, y: 594, width: 328, height: 19 }), box('qr-durdu', 'sendButton', { x: 31, y: 631, width: 328, height: 44 }));
    const d2 = Math.max(a.end, b.end + off) - .3;
    list.push({ name: 'd2-qr-etki', chapter: 3, duration: d2 + 1.2, split: { title: 'QR siparişleri', left: 'Açık', right: 'Durduruldu', leftTone: 'on', rightTone: 'off' },
      layers: [
        { kind: 'phone', clip: 'qr-acik', h: 690, keys: still(480, 585), map: play(0) },
        { kind: 'phone', clip: 'qr-durdu', h: 690, keys: [{ t: 0, x: 1440, y: 585 }, { t: b.sent + off + .3, x: 1440, y: 585 }, { t: b.sent + off + 1, x: 1250, y: 585 }], map: play(-off) },
        { kind: 'zoom', clip: 'qr-durdu', box: pad(notice, 10), width: 420, map: play(-off), keys: appear(1675, 585, b.sent + off + .9) },
      ],
      captions: [
        { from: .3, to: a.send, text: 'İki masada aynı sipariş: Türk kahvesi, şeker “Orta”.' },
        { from: a.send, to: d2 + 3, text: 'Durdurulunca menü açık kalır, sipariş gönderilemez.' },
      ] });
  }
  // B. QR siparişlerinde garson onayı · C. Müşteri siparişini değiştirip iptal edebilsin (Ayarlar → Sipariş ve mutfak → Sipariş ve onay)
  const settingScene = (name: string, clip: string, label: string, toc: string, extra: Caption[]) => {
    const m = marks(clip), row = box(clip, 'row', { x: 305, y: 384, width: 423, height: 85 }), rowOn = box(clip, 'rowOn', row), card = box(clip, 'card', row), d = m.end - .2;
    const near = around(union(row, rowOn), 760, 16 / 9, 0, 40);
    list.push({ name, chapter: 3, duration: d, capPos: 'overlay', place: 'Ayarlar → Sipariş ve mutfak → Sipariş ve onay', toc,
      layers: [full(clip, fullCam([0, FULL], [m.row - .2, FULL], [m.row + 1.2, near], [d, near]),
        [{ box: union(row, rowOn), from: m.row + 1.2, to: m.toggle + .2 }, { box: card.height > 400 ? rowOn : card, from: m.on + .4, to: d + 1 }], d)],
      captions: [
        { from: .3, to: m.row + .4, text: 'Ayarlar → Sipariş ve mutfak → Sipariş ve onay.' },
        { from: m.row + .4, to: m.on - .1, text: `“${label}”` },
        ...extra.map(c => ({ ...c, from: c.from < 0 ? m.on - .1 : c.from, to: c.to < 0 ? d + 1 : c.to })),
      ] });
  };
  settingScene('e1-onay-yer', 'ayar-onay', 'QR siparişlerinde garson onayı', 'Garson onayı', [{ from: -1, to: -1, text: 'Anahtar açılır; değişiklik hemen kaydedilir.' }]);
  {
    const a = marks('onay-kapali'), b = marks('onay-acik'), off = a.send - b.send, PH = 650;
    const d = Math.max(a.end, b.end + off) + .8;
    const tile = box('onay-kapali', 'tile', { x: 138, y: 191, width: 113, height: 88 });
    const lab = (text: string, x: number): Layer => ({ kind: 'html', html: `<span class="badge" style="font-size:20px;padding:8px 16px">${text}</span>`, keys: still(x, 222) });
    list.push({ name: 'e2-onay-etki', chapter: 3, duration: d, split: { title: 'QR siparişlerinde garson onayı', left: 'Kapalı', right: 'Açık' },
      layers: [
        { kind: 'phone', clip: 'onay-kapali', h: PH, keys: still(260, 590), map: play(0) }, lab('Misafir', 260),
        { kind: 'phone', clip: 'onay-kapali-personel', h: PH, keys: still(700, 590), map: play(0) }, lab('Garson', 700),
        { kind: 'phone', clip: 'onay-acik', h: PH, keys: still(1220, 590), map: play(-off) }, lab('Misafir', 1220),
        { kind: 'phone', clip: 'onay-acik-personel', h: PH, keys: still(1660, 590), map: play(-off) }, lab('Garson', 1660),
        { kind: 'zoom', clip: 'onay-kapali-personel', box: pad(tile, 8), width: 300, map: play(0), keys: appear(700, 800, a.waiterSees + .2) },
        // The waiter's approval list, enlarged while it is open.
        { kind: 'zoom', clip: 'onay-acik-personel', box: { x: 12, y: 40, width: 366, height: 200 }, width: 560, map: play(-off), keys: appear(1440, 760, b.waiterOpen + off + 1.6, b.approved + off + .4) },
      ],
      captions: [
        { from: .3, to: a.send + .6, text: 'İki masada aynı sipariş gönderilir.' },
        { from: a.send + .6, to: b.waiterOpen + off, text: 'Kapalı: sipariş doğrudan mutfağa gider. Açık: garsonun onayını bekler.' },
        { from: b.waiterOpen + off, to: b.approved + off + .3, text: 'Garson siparişi açar ve onaylar.' },
        { from: b.approved + off + .3, to: d + 1, text: 'Onaylanan sipariş mutfağa geçer; misafir “Onaylandı” görür.' },
      ] });
  }
  settingScene('f1-sure-yer', 'ayar-sure', 'Müşteri siparişini değiştirip iptal edebilsin', 'Sipariş değiştirme süresi',
    [{ from: -1, to: -1, text: 'Açılınca süre 30 saniye olur; 1–600 saniye arası yazılabilir.' }]);
  {
    const a = marks('sure-kapali'), b = marks('sure-acik'), off = a.send - b.send;
    // The right side's wait for the kitchen 6× faster; the left side plays on and holds its last frame.
    const fastFrom = b.track + 4.5, fastTo = b.kitchen - 1.6;
    const segB = segments([[0, fastFrom], [fastFrom, fastTo, 6], [fastTo, b.end - .2]], off);
    const d = Math.max(segB.end, a.end) + .6;
    const tA = box('sure-kapali', 'ticket', { x: 31, y: 149, width: 379, height: 297 }), tB = box('sure-acik', 'ticket', tA);
    const chg = box('sure-acik', 'change', { x: 35, y: 327, width: 157, height: 36 });
    const kcam = (t: Box) => fullCam([0, { x: 0, y: Math.max(40, Math.min(800 - 480 * 1.1, t.y - 60)), w: 480 }]);
    const lab = (text: string, x: number): Layer => ({ kind: 'html', html: `<span class="badge" style="font-size:20px;padding:8px 16px">${text}</span>`, keys: still(x, 222) });
    list.push({ name: 'f2-sure-etki', chapter: 3, duration: d, split: { title: 'Müşteri siparişini değiştirip iptal edebilsin', left: 'Kapalı', right: 'Açık · 30 sn' },
      layers: [
        { kind: 'phone', clip: 'sure-kapali', h: 650, keys: still(250, 590), map: [[0, 0], [a.end - .1, a.end - .1], [d + 5, a.end - .1]] }, lab('Misafir', 250),
        { kind: 'screen', clip: 'sure-kapali-personel', w: 420, h: 460, keys: still(690, 600), map: [[0, 0], [a.end - .1, a.end - .1], [d + 5, a.end - .1]], title: 'Mutfak ekranı', cam: kcam(tA),
          rings: [{ box: pad(tA, -4), from: a.kitchen + .2, to: d + 1 }] },
        { kind: 'phone', clip: 'sure-acik', h: 650, keys: still(1210, 590), map: segB.map }, lab('Misafir', 1210),
        { kind: 'screen', clip: 'sure-acik-personel', w: 420, h: 460, keys: still(1650, 600), map: segB.map, title: 'Mutfak ekranı', cam: kcam(tB),
          rings: [{ box: pad(tB, -4), from: segB.at(b.kitchen) + .2, to: d + 1 }] },
        { kind: 'zoom', clip: 'sure-acik', box: pad(chg, 6), width: 330, map: segB.map, keys: appear(1210, 720, segB.at(b.track) + 1, segB.at(fastTo) + .5) },
        { kind: 'html', html: `<span class="badge">6× hızlı</span>`, keys: [{ t: 0, x: 1650, y: 880, o: 0 }, { t: segB.at(fastFrom), x: 1650, y: 880, o: 0 }, { t: segB.at(fastFrom) + .3, x: 1650, y: 880, o: 1 }, { t: segB.at(fastTo) - .3, x: 1650, y: 880, o: 1 }, { t: segB.at(fastTo), x: 1650, y: 880, o: 0 }] },
      ],
      captions: [
        { from: .3, to: a.sent + 1, text: 'İki masada aynı sipariş gönderilir.' },
        { from: a.sent + 1, to: segB.at(fastFrom), text: 'Kapalı: mutfak siparişi hemen alır. Açık: misafir 30 sn değiştirebilir.' },
        { from: segB.at(fastFrom), to: segB.at(b.kitchen), text: 'Açıkken mutfak, süre dolana kadar bekler.' },
        { from: segB.at(b.kitchen), to: d + 1, text: 'Süre dolunca sipariş mutfak ekranına düşer.' },
      ] });
  }
  // D. QR kodlarını yazdır
  {
    const m = marks('ayar-yazdir'), d = m.end + 1.2;
    const cardB = box('ayar-yazdir', 'card', { x: 361, y: 387, width: 800, height: 332 }), layout = box('ayar-yazdir', 'layoutA6', { x: 745, y: 500, width: 391, height: 71 });
    const paper = box('ayar-yazdir', 'paper', { x: 386, y: 585, width: 324, height: 71 }), actions = box('ayar-yazdir', 'actions', { x: 386, y: 774, width: 750, height: 48 });
    const near = around(cardB, 960, 16 / 9, 0, 60);
    list.push({ name: 'g1-yazdir-yer', chapter: 3, duration: d, capPos: 'overlay', place: 'Ayarlar → Masalar ve QR → QR kodlarını yazdır', toc: 'QR kodlarını yazdırma',
      layers: [full('ayar-yazdir', fullCam([0, FULL], [m.options - .4, FULL], [m.options + .8, near], [d, near]),
        [{ box: layout, from: m.options + .8, to: m.a6 + .4 }, { box: union(paper, actions), from: m.a6 + .5, to: d + 1 }], d)],
      captions: [
        { from: .3, to: m.options + .4, text: 'Ayarlar → Masalar ve QR → QR kodlarını yazdır.' },
        { from: m.options + .4, to: m.a6 + .3, text: 'Baskı: A4’e 6 ya da 12 QR, ya da A6 masa standı.' },
        { from: m.a6 + .3, to: d + 1, text: 'Masa standı A4’e 4’lü ya da A6 kâğıda tek basılır.' },
      ] });
    const a4 = join(REC, 'baski', 'a4-6.png'), a6 = join(REC, 'baski', 'a6-stand.png');
    list.push({ name: 'g2-yazdir-etki', chapter: 3, duration: 7.5, split: { title: 'Baskı örnekleri', left: 'A4 · 6 QR', right: 'A6 masa standı', leftTone: 'on', rightTone: 'on' },
      layers: [
        { kind: 'image', src: img(a4), w: 480, keys: appear(480, 565, .2) },
        { kind: 'image', src: img(a6), w: 470, keys: appear(1440, 565, .45) },
      ],
      captions: [{ from: .4, to: 9, text: 'Her kodun altında masanın adı iri harflerle basılır.' }] });
  }
  list.push({ name: 'h0-son', duration: 9, card: endCard });
  return list;
}

// ---------- Rendering ----------
async function renderScene(browser: Browser, scene: Scene) {
  const htmlFile = join(WORK, `${scene.name}.html`); writeFileSync(htmlFile, stageHtml(scene));
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlFile).href);
  await page.evaluate('document.fonts.ready');
  await page.waitForFunction('[...document.images].every(function (i) { return !i.getAttribute("src") || (i.complete && i.naturalWidth > 0); })');
  const file = join(WORK, `${scene.name}.mp4`), total = Math.round(scene.duration * FPS);
  const ff = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-vf', `scale=${W}:${H}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-profile:v', 'high', '-level', '4.2',
    '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-r', String(FPS), '-g', String(FPS * 2), '-bf', '2', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise<number>(r => ff.on('exit', c => r(c ?? 1)));
  const write = (b: Buffer) => new Promise<void>(r => { if (ff.stdin.write(b)) r(); else ff.stdin.once('drain', () => r()); });
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    await page.evaluate(`renderAt(${(i / FPS).toFixed(4)})`);
    await write(await page.screenshot({ type: 'jpeg', quality: 96 }));
  }
  ff.stdin.end();
  if (await done !== 0) throw new Error(`${scene.name}: ffmpeg başarısız.`);
  await page.close();
  console.log(`  ${scene.name}: ${scene.duration.toFixed(1)} sn, ${((Date.now() - t0) / 1000).toFixed(0)} sn'de`);
}
/** One still per scene at a few moments (checking the layout without rendering). */
async function sceneStills(browser: Browser, list: Scene[]) {
  const shots: string[] = [];
  for (const s of list) {
    const htmlFile = join(WORK, `${s.name}.html`); writeFileSync(htmlFile, stageHtml(s));
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlFile).href); await page.evaluate('document.fonts.ready');
    for (const k of [.3, .6, .9]) {
      const t = s.duration * k; await page.evaluate(`renderAt(${t})`);
      const f = join(WORK, 'kare', `${s.name}-${Math.round(k * 100)}.jpg`); mkdirSync(join(WORK, 'kare'), { recursive: true });
      writeFileSync(f, await page.screenshot({ type: 'jpeg', quality: 80 })); shots.push(f);
    }
    await page.close();
  }
  return shots;
}
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function joinWithMusic(list: Scene[]) {
  const total = list.reduce((n, s) => n + Math.round(s.duration * FPS), 0) / FPS;
  // Soft breaks in the music where the chapter cards begin.
  const starts: number[] = []; let t = 0;
  for (const s of list) { if (s.card && t > 0) starts.push(t); t += Math.round(s.duration * FPS) / FPS; }
  const wav = join(WORK, 'muzik.wav');
  const py = spawnSync('python', [join(ROOT, 'scripts', 'sosyal', 'muzik.py'), wav, total.toFixed(2), 'canli-uzun', starts.map(x => x.toFixed(2)).join(',')], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (py.status !== 0) throw new Error(`Müzik üretilemedi: ${py.stderr}`);
  // Background level: measured, then one gain to about -20 LUFS (the track is steady; no dynamic compression).
  const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', wav, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS\s+Threshold[\s\S]*$/.exec(probe.stderr)?.[1] ?? /I:\s+(-?[\d.]+) LUFS/.exec(probe.stderr)?.[1]);
  const gain = (-20 - lufs).toFixed(2);
  const listFile = join(WORK, 'parcalar.txt');
  writeFileSync(listFile, list.map(s => `file '${join(WORK, `${s.name}.mp4`).replace(/\\/g, '/')}'`).join('\n'));
  const mp4 = join(OUT, 'QR menü ve QR sipariş.mp4');
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-af', `volume=${gain}dB,aresample=48000`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-shortest', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Birleştirme başarısız: ${r.stderr}`);
  console.log(`Video: ${mp4} · ${fmt(total)} · müzik ${lufs.toFixed(1)} LUFS → -20 (${gain} dB)`);
  return total;
}

// ---------- Description and thumbnail ----------
function description(list: Scene[]) {
  let t = 0; const toc: string[] = [];
  for (const s of list) { if (s.toc) toc.push(`${fmt(t)} ${s.toc}`); t += Math.round(s.duration * FPS) / FPS; }
  const title = 'QR menü ve QR sipariş: misafir, garson, mutfak ve ayarlar | Mola';
  if (title.length > 70) throw new Error(`Başlık ${title.length} karakter.`);
  const starts = toc.map(l => { const [mm, ss] = l.split(' ')[0].split(':').map(Number); return mm * 60 + ss; });
  starts.forEach((x, i) => { const next = starts[i + 1] ?? t; if (next - x < 10) throw new Error(`Bölüm 10 sn'den kısa: ${toc[i]}`); });
  const text = `BAŞLIK (${title.length} karakter)
${title}

AÇIKLAMA
Bu videoda Mola adisyon ve QR menü sisteminde QR menü ve QR siparişin nasıl çalıştığı gösteriliyor. Görüntüler uygulamanın kendisinden, örnek bir işletmeyle kaydedildi.

Bölüm 1 · Misafir gözünden: masadaki QR kodun okutulması, fotoğraflı menü, kategoriler ve arama, menünün İngilizce görünümü, seçenekli ürün (Türk kahvesi, şeker tercihi), sepet ve siparişin gönderilmesi, “Siparişlerim”, değiştirme süresi içinde siparişin değiştirilmesi, “Garson çağır” ve “Hesabı iste” (Nakit / Kart).
Bölüm 2 · İşletme tarafı: aynı siparişin garson telefonunda, mutfak ekranında ve kasa ekranında görünmesi; garson çağrısı ve hesap isteği.
Bölüm 3 · Ayarlar: QR siparişlerini durdurma, QR siparişlerinde garson onayı, müşterinin siparişini değiştirip iptal edebileceği süre ve masa QR kodlarının yazdırılması. Her ayarın yeri ve açık / kapalı hâlinin farkı yan yana gösteriliyor.

Bölümler
${toc.join('\n')}

Mola 30 gün ücretsiz denenebilir.
Web: https://molayazilim.com.tr
E-posta: destek@molayazilim.com.tr

ETİKETLER
QR menü, QR sipariş, adisyon programı, kafe adisyon, restoran adisyon, kafe yazılımı, masadan sipariş, dijital menü, garson çağırma, mutfak ekranı, kasa programı, Mola, Mola adisyon, Elazığ
`;
  writeFileSync(join(OUT, 'aciklama.txt'), text.replace(/\n/g, '\r\n'));
  console.log(toc.join('\n'));
}
function thumbHtml() {
  const shot = join(WORK, 'kapak-menu.png');
  return base(1280, 720, `
  <div class="left"><h1 class="serif">QR menü<br>ve QR sipariş</h1>
    <div class="brand">${mark(64)}<span class="serif">mola<i>.</i></span></div></div>
  <div class="phone"><div class="screen"><img src="${img(shot)}"></div></div>
  <div class="qr"><svg viewBox="0 0 24 24" width="74" height="74" fill="none" stroke="${C.green}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg></div>`, `
  body{background:radial-gradient(80% 90% at 25% 40%,#2a5848 0%,${C.green} 58%,#1d4134 100%);color:${C.cup}}
  .left{position:absolute;left:70px;top:0;bottom:0;width:690px;display:flex;flex-direction:column;justify-content:center}
  .eyebrow{font:700 22px/1 ${SANS};letter-spacing:.24em;color:rgba(243,235,221,.78);display:flex;align-items:center;gap:14px}
  .eyebrow::before{content:"";width:36px;height:3px;background:${C.accent};border-radius:2px}
  h1{font-weight:400;font-size:120px;line-height:1.0;letter-spacing:-.03em}
  .brand{display:flex;align-items:center;gap:16px;margin-top:46px;font-size:52px}.brand svg{border-radius:14px;box-shadow:0 0 0 2px rgba(243,235,221,.3)}.brand i{font-style:normal;color:#d9875f}
  .phone{position:absolute;left:820px;top:52px;width:318px;height:672px;padding:12px;border-radius:44px;background:#1c2721;box-shadow:0 40px 80px -20px rgba(0,0,0,.55),inset 0 0 0 2px #3a4a41;transform:rotate(4deg)}
  .phone .screen{width:294px;height:636px;border-radius:33px;overflow:hidden;background:${C.paper}}.phone img{width:100%;display:block}
  .qr{position:absolute;left:744px;top:470px;width:120px;height:120px;border-radius:30px;background:${C.cup};display:grid;place-items:center;box-shadow:0 24px 50px -16px rgba(0,0,0,.55)}`);
}
async function thumbnail(browser: Browser) {
  // The menu as the guest sees it (a phone frame of the recording, top part).
  const m = meta('ana'), mk = marks('ana'), at = mk.categories - .2;
  const i = m.frames.findLastIndex(x => x.t - m.marks.start <= at);
  const src = join(REC, 'ana', m.frames[i].file);
  await sharp(src).png().toFile(join(WORK, 'kapak-menu.png'));
  const htmlFile = join(WORK, 'kapak.html'); writeFileSync(htmlFile, thumbHtml());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlFile).href); await page.evaluate('document.fonts.ready');
  await page.waitForFunction('[...document.images].every(function (i) { return i.complete && i.naturalWidth > 0; })');
  const png = await page.screenshot({ type: 'png' });
  await page.close();
  await sharp(png).jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(join(OUT, 'kapak.jpg'));
  // How it reads small (YouTube's list size).
  await sharp(png).resize(246, 138).png().toFile(join(WORK, 'kapak-kucuk.png'));
  console.log(`Kapak: ${join(OUT, 'kapak.jpg')}`);
}

async function main() {
  const list = scenes();
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    if (stills) { const shots = await sceneStills(browser, only.length ? list.filter(s => only.includes(s.name) || only.some(o => s.name.startsWith(o))) : list); console.log(`${shots.length} kare: ${join(WORK, 'kare')}`); return; }
    if (!coverOnly) {
      const todo = list.filter(s => only.length ? only.includes(s.name) || only.some(o => s.name.startsWith(o)) : true).filter(s => only.length || !existsSync(join(WORK, `${s.name}.mp4`)) || process.env.HEPSI);
      const queue = [...todo];
      await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => { for (let s = queue.shift(); s; s = queue.shift()) await renderScene(browser, s); }));
      const missing = list.filter(s => !existsSync(join(WORK, `${s.name}.mp4`)));
      if (missing.length) throw new Error(`Eksik sahneler: ${missing.map(s => s.name).join(', ')}`);
      await joinWithMusic(list);
    }
    description(list);
    await thumbnail(browser);
  } finally { await browser.close(); }
}
await main();
