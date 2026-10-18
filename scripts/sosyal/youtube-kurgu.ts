/*
 * YouTube pilot 1 "QR menü ve QR sipariş" (sürüm 2, 18 Ekim): the 1920×1080 video, its thumbnail and description, made from
 * the recordings of scripts/sosyal/youtube-qr-kayit.ts. No voice-over: captions and the background music of
 * scripts/sosyal/muzik.py (canli-uzun).
 *
 *   npx tsx scripts/sosyal/youtube-kurgu.ts                everything (scenes → video → music → kapak.jpg, aciklama.txt)
 *   npx tsx scripts/sosyal/youtube-kurgu.ts b2 c3          only these scenes again (then the video is joined again)
 *   npx tsx scripts/sosyal/youtube-kurgu.ts --kare         a few stills per scene (layout check), no video
 *   npx tsx scripts/sosyal/youtube-kurgu.ts --kapak        only the thumbnail and the description
 *   SOSYAL_CIKTI=<klasör> …                                another output folder
 *
 * The owner's rules (18 Ekim): one linear story, one subject on screen at a time (the only exception: the before/after split
 * after each setting); no pointer and steady framing (sürüm 3): an ordinary tap shows only a soft touch ripple; a red outline
 * and a slight (1.2×) camera move only on the setting's own switch or field; a label at the top right says whose screen it is and the guest's step; no speed notes;
 * plain captions that only say what happens; a closing report scene (QR sipariş payı). Opening: the word "mola" and its dot gliding in from the start of the word.
 *
 * Every scene is an HTML stage drawn for every frame at 30 fps from the recorded frames, each frame a screenshot piped to
 * ffmpeg; scenes are rendered side by side in a few Chrome pages, then joined (same encoding, stream copy) and given the music:
 * H.264 High, yuv420p BT.709, AAC 48 kHz stereo, music at about -20 LUFS.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from '@playwright/test';
import sharp from 'sharp';

const ROOT = resolve('.');
const REC = join(ROOT, '.local', 'sosyal', 'youtube', 'kayit');
const WORK = join(ROOT, '.local', 'sosyal', 'youtube', 'kurgu');
const OUT = resolve(process.env.SOSYAL_CIKTI ?? join(ROOT, '..', 'Mola YouTube', '01 QR menü ve QR sipariş'));
const FFMPEG = process.env.FFMPEG ?? 'C:\\FFmpeg\\bin\\ffmpeg.exe';
const args = process.argv.slice(2), only = args.filter(a => !a.startsWith('--'));
const stills = args.includes('--kare'), coverOnly = args.includes('--kapak');
const FPS = 30, W = 1920, H = 1080, PARALLEL = Number(process.env.PARALEL ?? 4);
mkdirSync(WORK, { recursive: true }); mkdirSync(OUT, { recursive: true });

// ---------- Brand (site/src/assets/site.css), as scripts/sosyal/blok1-kurgu.ts ----------
const C = { green900: '#163328', green: '#234c3e', green700: '#2c5c4a', green500: '#4f8566', green200: '#cfe0d3', cream: '#e6dfd1', bg: '#ece6da', paper: '#f6f1e8', ink: '#1f3128', muted: '#5a6a61', line: '#ddd5c6', accent: '#b96844', dot: '#d9875f', cup: '#f3ebdd', red: '#d8322a' };
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
type RecTap = { name: string; box: Box; on: number; tap?: number; off?: number };
type Meta = { size: { width: number; height: number; scale: number }; frames: { file: string; t: number }[]; marks: Record<string, number>; boxes?: Record<string, Box | null>; taps?: RecTap[] };
const metas = new Map<string, Meta>();
const meta = (clip: string) => { if (!metas.has(clip)) metas.set(clip, JSON.parse(readFileSync(join(REC, clip, 'meta.json'), 'utf8')) as Meta); return metas.get(clip)!; };
/** Mark times relative to the clip's start. */
const marks = (clip: string) => { const m = meta(clip); return Object.fromEntries(Object.entries(m.marks).map(([k, v]) => [k, v - m.marks.start])) as Record<string, number>; };
/** Taps and highlights relative to the clip's start, by name. */
const taps = (clip: string) => { const m = meta(clip), s = m.marks.start; return Object.fromEntries((m.taps ?? []).map(t => [t.name, { ...t, on: t.on - s, tap: t.tap && t.tap - s, off: t.off && t.off - s }])) as Record<string, RecTap>; };
const box = (clip: string, name: string, fallback: Box): Box => meta(clip).boxes?.[name] ?? fallback;
const frames = (clip: string) => { const m = meta(clip); return m.frames.map(f => ({ src: img(join(REC, clip, f.file)), t: f.t - m.marks.start })); };

// ---------- Scenes ----------
type Key = { t: number; x: number; y: number; s?: number; o?: number };
/** [scene time, clip time] points; straight lines between them, slope 1 outside. Two points with the same clip time hold a frame. */
type TimeMap = [number, number][];
type Cam = { t: number; x: number; y: number; w: number };
type Ring = { box: Box; from: number; to: number; tap?: number; ripple?: boolean };
type Layer =
  | { kind: 'phone'; clip: string; h: number; keys: Key[]; map: TimeMap; rings: Ring[]; crop?: { x: number; y: number; w: number; h: number } }
  | { kind: 'screen'; clip: string; w: number; h: number; keys: Key[]; map: TimeMap; cam: Cam[]; rings: Ring[]; frame: 'none' | 'window' | 'tablet' | 'display'; title?: string }
  | { kind: 'image'; src: string; w: number; keys: Key[] }
  | { kind: 'html'; html: string; keys: Key[] };
type Caption = { from: number; to: number; text: string; step?: number };
type Scene = {
  name: string; duration: number; captions?: Caption[]; capPos?: 'side' | 'bottom' | 'overlay' | 'split';
  layers?: Layer[]; card?: string; split?: { title: string; left: string; right: string; leftTone?: 'off' | 'on'; rightTone?: 'off' | 'on' };
  /** Top-right label: a fixed text, or 'guest' for "Misafir tarafı · Adım n / N" from the captions' steps. */
  tag?: string; side?: 'guest' | 'business' | 'compare';
  /** YouTube chapter starting with this scene. */
  toc?: string;
};
let GUEST_STEPS = 11;

function stageHtml(scene: Scene) {
  const data = {
    duration: scene.duration, captions: scene.captions ?? [], tag: scene.tag ?? '', steps: GUEST_STEPS,
    layers: (scene.layers ?? []).map(l => 'clip' in l ? { ...l, frames: frames(l.clip), size: meta(l.clip).size, end: marks(l.clip).end } : l),
  };
  const split = scene.split ? `<div class="split"><div class="divider"></div><h2 class="serif">${scene.split.title}</h2>
    <span class="half-label ${scene.split.leftTone ?? 'off'}" style="left:480px">${scene.split.left}</span><span class="half-label ${scene.split.rightTone ?? 'on'}" style="left:1440px">${scene.split.right}</span></div>` : '';
  return base(W, H, `
  <div class="bg${scene.card ? ' card-bg' : ''}"></div>
  ${scene.card ?? ''}
  ${split}
  <div id="layers">${data.layers.map((l, i) => l.kind === 'phone' ? `${l.crop ? `<div class="crop" style="left:${l.crop.x}px;top:${l.crop.y}px;width:${l.crop.w}px;height:${l.crop.h}px">` : ''}<div class="phone L" id="l${i}"><div class="screen"><img><div class="rings"></div></div></div>${l.crop ? '</div>' : ''}`
    : l.kind === 'screen' ? `<div class="dev L ${l.frame}" id="l${i}">${l.frame === 'window' ? `<div class="bar"><span></span><span></span><span></span><em>${l.title ?? ''}</em></div>` : ''}<div class="view"><img><div class="rings"></div></div></div>`
    : l.kind === 'image' ? `<div class="paper L" id="l${i}"><img src="${l.src}" style="width:${l.w}px"></div>`
    : `<div class="L" id="l${i}">${l.html}</div>`).join('')}</div>
  ${scene.tag ? `<div class="tag ${scene.side ?? 'business'}" id="tag"><i></i><span></span></div>` : ''}
  <div class="cap ${scene.capPos ?? 'bottom'}" id="cap"><div></div></div>
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
  /** The red "tap here" outline: fades in, breathes gently, gives a short press at the tap, fades out. */
  function rings(container, list, t, tx) {
    let html = '';
    for (const r of list) {
      if (r.ripple) {
        // An ordinary tap: a soft translucent circle at the touch point, growing and fading in ~0.45 s.
        const k = (t - r.from) / (r.to - r.from); if (k < 0 || k > 1) continue;
        const b = tx(r.box), z = b.w / Math.max(1, r.box.width), R = 30 * z * (.55 + .65 * k), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        html += '<b style="opacity:' + ((1 - k) * .9) + ';left:' + (cx - R) + 'px;top:' + (cy - R) + 'px;width:' + (2 * R) + 'px;height:' + (2 * R) + 'px"></b>';
        continue;
      }
      const o = Math.min(clamp((t - r.from) / .3, 0, 1), clamp((r.to - t) / .3, 0, 1)); if (o <= 0) continue;
      const b = tx(r.box), p = 9, pulse = 1 + .035 * Math.sin((t - r.from) * 2 * Math.PI * 1.1);
      const press = r.tap !== undefined ? clamp(1 - Math.abs(t - r.tap) / .18, 0, 1) : 0;
      const s = pulse * (1 - .06 * press);
      html += '<i style="opacity:' + o + ';left:' + (b.x - p) + 'px;top:' + (b.y - p) + 'px;width:' + (b.w + 2 * p) + 'px;height:' + (b.h + 2 * p) + 'px;transform:scale(' + s + ');background:rgba(216,50,42,' + (.14 * press) + ')"></i>';
    }
    container.innerHTML = html;
  }
  D.layers.forEach((l, i) => {
    const el = document.getElementById('l' + i);
    if (l.kind === 'phone') { const sw = l.h * 390 / 844, pad = Math.round(sw * .035), r = Math.round(sw * .13);
      el.style.width = (sw + 2 * pad) + 'px'; el.style.height = (l.h + 2 * pad) + 'px'; el.style.padding = pad + 'px'; el.style.borderRadius = r + 'px';
      const s = el.querySelector('.screen'); s.style.width = sw + 'px'; s.style.height = l.h + 'px'; s.style.borderRadius = (r - pad) + 'px'; }
    if (l.kind === 'screen') { const v = el.querySelector('.view'); v.style.width = l.w + 'px'; v.style.height = l.h + 'px'; }
  });
  window.renderAt = async function (t) {
    D.layers.forEach((l, i) => {
      const el = document.getElementById('l' + i), k0 = key(l.keys, t), k = l.crop ? { ...k0, x: k0.x - l.crop.x, y: k0.y - l.crop.y } : k0;
      place(el, k);
      if ((k.o ?? 1) <= 0.001 || !l.frames) return;
      const ct = clamp(mapT(l.map || [], t), 0, l.end - .02), im = el.querySelector('img');
      if (l.kind === 'phone') {
        setSrc(im, frameAt(l.frames, ct));
        const z = l.h / 844;
        rings(el.querySelector('.rings'), l.rings || [], t, b => ({ x: b.x * z, y: b.y * z, w: b.width * z, h: b.height * z }));
      }
      if (l.kind === 'screen') {
        const c = key(l.cam, t), z = l.w / c.w;
        im.style.width = (l.size.width * z) + 'px'; im.style.height = (l.size.height * z) + 'px';
        im.style.transform = 'translate(' + (-c.x * z) + 'px,' + (-c.y * z) + 'px)';
        setSrc(im, frameAt(l.frames, ct));
        rings(el.querySelector('.rings'), l.rings || [], t, b => ({ x: (b.x - c.x) * z, y: (b.y - c.y) * z, w: b.width * z, h: b.height * z }));
      }
    });
    if (window.cardAnim) window.cardAnim(t);
    const cap = document.getElementById('cap'), c = D.captions.find(c => t >= c.from && t < c.to);
    if (!c) cap.style.opacity = 0;
    else {
      if (cap.dataset.text !== c.text) { cap.firstChild.innerHTML = c.text; cap.dataset.text = c.text; }
      const inK = clamp((t - c.from) / .45, 0, 1), outK = clamp((c.to - t) / .3, 0, 1);
      cap.style.opacity = Math.min(ease(inK), outK);
      cap.style.transform = 'translateY(' + ((1 - ease(inK)) * 16) + 'px)';
    }
    const tag = document.getElementById('tag');
    if (tag) {
      let text = D.tag;
      if (D.tag === 'guest') { const last = [...D.captions].reverse().find(c => c.step && t >= c.from) || D.captions.find(c => c.step); text = 'Misafir tarafı <b>· Adım ' + (last ? last.step : 1) + ' / ' + D.steps + '</b>'; }
      const sp = tag.querySelector('span'); if (sp.innerHTML !== text) sp.innerHTML = text;
    }
    const f = document.getElementById('fade'); f.style.opacity = t < .3 ? 1 - t / .3 : t > D.duration - .3 ? (t - (D.duration - .3)) / .3 : 0;
    await Promise.all(pending.splice(0));
  };
  </script>`, `
  body{background:${C.bg}}
  .bg{position:absolute;inset:0;background:radial-gradient(60% 55% at 88% 12%,rgba(214,220,200,.9),rgba(214,220,200,0)),radial-gradient(55% 50% at 6% 92%,rgba(246,230,220,.9),rgba(246,230,220,0)),${C.bg}}
  .card-bg{background:radial-gradient(80% 70% at 50% 45%,#2a5848 0%,${C.green} 60%,#1d4134 100%)}
  .L{position:absolute;left:0;top:0;transform-origin:50% 50%;will-change:transform}
  .crop{position:absolute;overflow:hidden;border-radius:28px}
  .phone{background:#1c2721;box-shadow:0 50px 90px -40px rgba(22,51,40,.55),0 16px 34px -18px rgba(22,51,40,.35),inset 0 0 0 2px #3a4a41}
  .phone .screen{position:relative;overflow:hidden;background:${C.paper}}
  .phone .screen img{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
  .dev{position:absolute;left:0;top:0;transform-origin:50% 50%}
  .dev .view{position:relative;overflow:hidden;background:${C.paper}}.dev .view img{position:absolute;left:0;top:0;transform-origin:0 0}
  .dev.window{background:${C.paper};border-radius:22px;overflow:hidden;box-shadow:0 50px 90px -40px rgba(22,51,40,.5),0 0 0 2px ${C.line}}
  .dev.window .bar{display:flex;align-items:center;gap:9px;height:44px;padding:0 20px;background:${C.cream};border-bottom:2px solid ${C.line}}
  .dev.window .bar span{width:13px;height:13px;border-radius:50%;background:#d9ddd5}.dev.window .bar span:nth-child(1){background:#e8b7a3}.dev.window .bar span:nth-child(2){background:#ead7a6}.dev.window .bar span:nth-child(3){background:#b9d3bf}
  .dev.window .bar em{margin-left:12px;font:600 21px/1 ${SANS};font-style:normal;color:#5f6b63}
  .dev.tablet{padding:22px;border-radius:40px;background:#1c2721;box-shadow:0 50px 90px -40px rgba(22,51,40,.55),inset 0 0 0 2px #3a4a41}
  .dev.tablet .view{border-radius:16px}
  .dev.display{padding:18px 18px 34px;border-radius:20px;background:#222c27;box-shadow:0 50px 90px -40px rgba(22,51,40,.55),inset 0 0 0 2px #3a4a41}
  .dev.display .view{border-radius:6px}
  .rings{position:absolute;inset:0;pointer-events:none;overflow:visible}
  .rings i{position:absolute;border:5px solid ${C.red};border-radius:14px;box-shadow:0 0 0 6px rgba(216,50,42,.18),0 6px 18px rgba(216,50,42,.25);transform-origin:50% 50%}
  .rings b{position:absolute;border-radius:50%;background:rgba(255,255,255,.38);border:2px solid rgba(35,76,62,.32);box-shadow:0 0 0 5px rgba(35,76,62,.07)}
  .phone .rings i{border-width:3px;border-radius:10px;box-shadow:0 0 0 4px rgba(216,50,42,.18)}
  .paper{background:#fff;border-radius:6px;box-shadow:0 40px 80px -30px rgba(22,51,40,.55),0 0 0 1px ${C.line}}.paper img{display:block;border-radius:6px}
  .tag{position:absolute;right:34px;top:26px;display:flex;align-items:center;gap:14px;padding:13px 26px 13px 20px;border-radius:999px;background:rgba(246,241,232,.96);box-shadow:0 10px 26px -12px rgba(22,51,40,.5),0 0 0 2px ${C.line};font:600 26px/1 ${SANS};color:${C.green900};z-index:7;white-space:nowrap}
  .tag b{font-weight:600;color:${C.muted}}
  .tag i{width:14px;height:14px;border-radius:50%;background:${C.green500}}.tag.guest i{background:${C.dot}}.tag.compare i{background:${C.muted}}
  .cap{position:absolute;opacity:0;z-index:6;color:${C.green900}}
  .cap em{font-style:normal;color:${C.accent}}
  .cap.side{left:1040px;width:800px;top:300px;height:480px;display:flex;align-items:center;font:400 58px/1.17 ${SERIF};letter-spacing:-.015em}
  .cap.bottom{left:0;right:0;top:944px;height:116px;display:flex;align-items:center;justify-content:center;text-align:center;font:400 46px/1.15 ${SERIF};letter-spacing:-.01em}
  .cap.split{left:0;right:0;top:982px;height:80px;display:flex;align-items:center;justify-content:center;text-align:center;font:400 42px/1.15 ${SERIF}}
  .cap.overlay{left:0;right:0;bottom:44px;display:flex;justify-content:center}
  .cap.overlay div{padding:22px 40px;border-radius:26px;background:rgba(246,241,232,.97);box-shadow:0 24px 50px -20px rgba(22,51,40,.55),0 0 0 2px ${C.line};font:400 44px/1.15 ${SERIF};white-space:nowrap}
  .split h2{position:absolute;left:0;right:0;top:40px;text-align:center;font-weight:400;font-size:44px;color:${C.green900};letter-spacing:-.01em}
  .split .divider{position:absolute;left:959px;top:130px;width:2px;height:830px;background:${C.line}}
  .half-label{position:absolute;top:126px;transform:translateX(-50%);padding:11px 28px;border-radius:999px;font:700 25px/1 ${SANS};letter-spacing:.04em;z-index:4;white-space:nowrap}
  .half-label.off{background:${C.cream};color:${C.muted};box-shadow:inset 0 0 0 2px ${C.line}}
  .half-label.on{background:${C.green};color:${C.cup}}
  .fade{position:absolute;inset:0;background:${C.bg};pointer-events:none;z-index:9}
  ${scene.card ? cardCss : ''}`);
}

// ---------- Cards: the logo animation ----------
const cardCss = `
  .logo{position:absolute;left:0;right:0;top:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:${C.cup}}
  .wordbox{position:relative;font:400 210px/1 ${SERIF};letter-spacing:-.03em;white-space:nowrap}
  .wordbox .ghost{visibility:hidden}
  .wordbox .dot{position:absolute;left:0;top:0;color:${C.dot}}
  .wordbox svg{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
  .sub{margin-top:26px;font:700 30px/1 ${SANS};letter-spacing:.32em;padding-left:.32em;color:rgba(207,224,211,.9);opacity:0}
  .title{position:absolute;left:0;right:0;top:640px;text-align:center;opacity:0}
  .title h1{font:400 92px/1.05 ${SERIF};letter-spacing:-.02em;color:${C.cup}}
  .title p{margin-top:26px;font:400 32px/1.35 ${SANS};color:rgba(243,235,221,.8)}
  .site{position:absolute;left:0;right:0;top:700px;text-align:center;opacity:0}
  .site b{display:block;font:600 52px/1 ${SANS};color:${C.cup}}
  .site span{display:block;margin-top:22px;font:400 30px/1 ${SANS};color:rgba(243,235,221,.72)}`;
/**
 * "mola" appears, then its dot comes in from the start of the word: it travels along under the word in a soft curve (with a
 * fading trace, like a swoosh) and settles where the full stop of "mola." stands. `dot0`–`dot1`: the dot's journey (s).
 */
function logoCard(o: { dot0: number; dot1: number; lift?: [number, number]; extra: string; extraIn: number; extraClass: string }) {
  return `<div class="logo" id="logo"><div class="wordbox" id="wb"><span id="word">mola</span><span class="ghost" id="ghost">.</span><span class="dot" id="dot">.</span><svg id="trail" width="10" height="10"><path id="trailPath" fill="none" stroke="${C.dot}" stroke-width="7" stroke-linecap="round"/></svg></div><div class="sub" id="sub">ADİSYON · QR MENÜ</div></div>
  <div class="${o.extraClass}" id="extra">${o.extra}</div>
  <script>
  (function () {
    const e3 = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2, c01 = v => Math.max(0, Math.min(1, v));
    let G;
    function geo() {
      const wb = document.getElementById('wb').getBoundingClientRect(), w = document.getElementById('word').getBoundingClientRect(), g = document.getElementById('ghost').getBoundingClientRect();
      // The dot glyph's own box; its visible dot sits near the bottom of the box.
      const end = { x: g.left - wb.left, y: 0 }, start = { x: w.left - wb.left - g.width * .9, y: w.height * .36 }, ctrl = { x: (w.width) * .5, y: w.height * .52 };
      return { end, start, ctrl, fs: w.height };
    }
    window.cardAnim = function (t) {
      G = G || geo();
      const word = document.getElementById('word'), dot = document.getElementById('dot'), sub = document.getElementById('sub'), extra = document.getElementById('extra'), path = document.getElementById('trailPath');
      const wk = e3(c01(t / .8)); word.style.opacity = wk; word.style.display = 'inline-block'; word.style.transform = 'translateY(' + ((1 - wk) * 24) + 'px)';
      const k = e3(c01((t - ${o.dot0}) / (${o.dot1} - ${o.dot0}))), q = (a, b, c) => (1 - k) * (1 - k) * a + 2 * (1 - k) * k * b + k * k * c;
      const x = q(G.start.x, G.ctrl.x, G.end.x), y = q(G.start.y, G.ctrl.y, G.end.y);
      dot.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      dot.style.opacity = c01((t - ${o.dot0} + .15) / .25);
      // The trace behind the dot (in the dot's own coordinates: the visible dot is ~0.82 em down the glyph box).
      const dy = G.fs * .80, dx = G.fs * .07, pts = [];
      for (let i = 0; i <= 24; i++) { const kk = k * i / 24, qq = (a, b, c) => (1 - kk) * (1 - kk) * a + 2 * (1 - kk) * kk * b + kk * kk * c; pts.push((qq(G.start.x, G.ctrl.x, G.end.x) + dx).toFixed(1) + ',' + (qq(G.start.y, G.ctrl.y, G.end.y) + dy).toFixed(1)); }
      path.setAttribute('d', 'M' + pts.join(' L'));
      path.style.opacity = Math.max(0, Math.min(c01((t - ${o.dot0}) / .2), 1 - c01((t - ${o.dot1} + .1) / .7))) * .55;
      sub.style.opacity = e3(c01((t - ${o.dot1} - .1) / .6));
      const lift = ${JSON.stringify(o.lift ?? null)};
      if (lift) { const lk = e3(c01((t - lift[0]) / (lift[1] - lift[0]))); document.getElementById('logo').style.transform = 'translateY(' + (-170 * lk) + 'px) scale(' + (1 - .32 * lk) + ')'; }
      const ek = e3(c01((t - ${o.extraIn}) / .7)); extra.style.opacity = ek; extra.style.transform = 'translateY(' + ((1 - ek) * 20) + 'px)';
    };
  })();
  </script>`;
}
const introCard = logoCard({ dot0: .9, dot1: 2.7, lift: [3.6, 4.5], extraIn: 4.3, extraClass: 'title',
  extra: `<h1>QR menü ve QR sipariş</h1><p>Misafirin telefonu, işletmenin ekranları ve bunları belirleyen ayarlar.</p>` });
const endCard = logoCard({ dot0: .6, dot1: 2.0, lift: [2.6, 3.4], extraIn: 3.2, extraClass: 'site', extra: `<b>molayazilim.com.tr</b><span>30 gün ücretsiz deneme</span>` });

// ---------- Taps, cuts and the (rare) camera moves ----------
/*
 * Version 3 (owner, 18 Ekim): steady framing, no zoom on ordinary taps. An ordinary tap shows only a soft touch ripple, and
 * the still moment the recorder held before it is cut short. A red outline (and a slight 1.2× camera move) only where the
 * viewer must find something: the setting's switch or field ("!" in front of the tap's name).
 */
type Focus = { box: Box; on: number; tap?: number; off?: number };
/** A clip window with the still lead-ins of ordinary taps cut out; `at` turns clip time into scene time. */
function cutLeads(clip: string, from: number, to: number, names: string[]) {
  const t = taps(clip), plain = names.filter(n => !n.startsWith('!'));
  const cuts = plain.map(n => t[n]).filter(x => x && x.tap !== undefined && x.on >= from && x.tap <= to)
    .map(x => [x.on + .15, x.tap! - .4] as [number, number]).filter(([a, b]) => b - a > .2).sort((p, q) => p[0] - q[0]);
  const parts: { c0: number; c1: number; s0: number }[] = []; let c = from, sc = 0;
  for (const [a, b] of cuts) { parts.push({ c0: c, c1: a, s0: sc }); sc += a - c; c = b; }
  parts.push({ c0: c, c1: to, s0: sc }); sc += to - c;
  const map: TimeMap = parts.flatMap(p => [[p.s0, p.c0], [p.s0 + (p.c1 - p.c0) - .0005, p.c1]] as [number, number][]);
  const at = (x: number) => { for (const p of parts) if (x <= p.c1) return p.s0 + Math.max(0, x - p.c0); return sc; };
  return { map, at, d: sc };
}
/** Ripples for the ordinary taps, outlines (Focus) for the marked ones and marked looks. */
function tapMarks(clip: string, names: string[], at: (c: number) => number, d: number) {
  const t = taps(clip), ripples: Ring[] = [], focuses: Focus[] = [];
  for (const raw of names) {
    const marked = raw.startsWith('!'), x = t[raw.replace('!', '')];
    if (!x || x.box.width <= 0) continue;
    if (marked) { const f = { box: x.box, on: at(x.on), tap: x.tap !== undefined ? at(x.tap) : undefined, off: x.off !== undefined ? at(x.off) : undefined }; if (f.on >= 0 && f.on < d) focuses.push(f); }
    else if (x.tap !== undefined) { const s0 = at(x.tap); if (s0 >= 0 && s0 < d) ripples.push({ box: x.box, from: s0, to: s0 + .45, ripple: true }); }
  }
  return { ripples, focuses };
}
const outlinesOf = (fs: Focus[]): Ring[] => fs.map(f => ({ box: f.box, from: f.on + .3, to: f.tap !== undefined ? f.tap + .2 : f.off!, tap: f.tap }));
/** Camera keys for the marked focuses only: a slight, gentle move in and back. */
function focusKeys<T extends { t: number }>(rest: Omit<T, 't'>, fs: Focus[], zoomed: (f: Focus) => Omit<T, 't'>): T[] {
  const keys: T[] = [{ t: 0, ...rest } as T];
  let prev = rest, last = 0;
  fs.forEach((f, i) => {
    const end = f.tap !== undefined ? f.tap + .5 : f.off! - .1;
    const tIn = Math.max(last + .01, f.on - .3);
    keys.push({ t: tIn, ...prev } as T, { t: Math.max(tIn + .5, f.on + .7), ...zoomed(f) } as T, { t: Math.max(tIn + .55, end), ...zoomed(f) } as T);
    last = Math.max(tIn + .55, end);
    const next = fs[i + 1];
    if (next && next.on - .3 - last < 1.2) prev = zoomed(f);
    else { keys.push({ t: last + 1, ...rest } as T); last += 1; prev = rest; }
  });
  return keys.sort((a, b) => a.t - b.t);
}
/** A region of a w×h screen around a box, `rw` wide with the given aspect, kept inside the screen. */
function around(b: Box, rw: number, aspect: number, sw: number, sh: number) {
  const rh = rw / aspect;
  return { x: Math.max(0, Math.min(sw - rw, b.x + b.width / 2 - rw / 2)), y: Math.max(0, Math.min(sh - rh, b.y + b.height / 2 - rh / 2)), w: rw };
}

// ---------- Scene builders ----------
const PHONE_REST = { x: 590, y: 540 }, PHONE_H = 930;
type CaptionsOf = (at: (c: number) => number, d: number) => Caption[];
/** One guest phone, big and steady, captions at the side; the clip window [from, to] (clip time). */
function guestScene(name: string, clip: string, from: number, to: number, names: string[], captions: CaptionsOf, toc?: string): Scene {
  const { map, at, d } = cutLeads(clip, from, to, names), { ripples } = tapMarks(clip, names, at, d);
  return { name, duration: d, capPos: 'side', tag: 'guest', side: 'guest', toc, captions: captions(at, d),
    layers: [{ kind: 'phone', clip, h: PHONE_H, keys: [{ t: 0, ...PHONE_REST, s: 1 }], map, rings: ripples }] };
}
/** The owner's desktop full screen; the camera moves (1.2×) only for the marked control. */
function ownerScene(name: string, clip: string, from: number, to: number, names: string[], captions: CaptionsOf, toc?: string): Scene {
  const { map, at, d } = cutLeads(clip, from, to, names), { ripples, focuses } = tapMarks(clip, names, at, d);
  const cam = focusKeys<Cam>({ x: 0, y: 40, w: 1280 }, focuses, f => around(f.box, 1280 / 1.2, 16 / 9, 1280, 800));
  return { name, duration: d, capPos: 'overlay', tag: 'İşletme tarafı <b>· Ayarlar</b>', side: 'business', toc, captions: captions(at, d),
    layers: [{ kind: 'screen', clip, w: W, h: H, keys: [{ t: 0, x: W / 2, y: H / 2 }], map, cam, rings: [...ripples, ...outlinesOf(focuses)], frame: 'none' }] };
}
/** A staff device (tablet, kitchen display, counter window), large, steady and alone, captions below. */
function staffScene(name: string, clip: string, from: number, to: number, o: { frame: 'tablet' | 'display' | 'window'; title?: string; tag: string; taps?: string[] }, captions: CaptionsOf, toc?: string): Scene {
  const size = meta(clip).size, names = o.taps ?? [];
  const { map, at, d } = cutLeads(clip, from, to, names), { ripples } = tapMarks(clip, names, at, d);
  const w = o.frame === 'tablet' ? 1160 : 1150, h = w * size.height / size.width;
  const y = o.frame === 'window' ? 512 : 505;
  return { name, duration: d, capPos: 'bottom', tag: o.tag, side: 'business', toc, captions: captions(at, d),
    layers: [{ kind: 'screen', clip, w, h, keys: [{ t: 0, x: W / 2, y }], map, cam: [{ t: 0, x: 0, y: 0, w: size.width }], rings: ripples, frame: o.frame, title: o.title }] };
}
/** Before / after: two guest phones side by side at normal size, each holding one moment of its clip; labels only. */
type Side = { clip: string; t: number; label: string; tone?: 'off' | 'on'; play?: number };
function splitScene(name: string, title: string, left: Side, right: Side, caption: string, d = 7.5): Scene {
  const hold = (t: number, play = 0): TimeMap => [[0, t], [play + .01, t + play], [d + 5, t + play]];
  const PH = 770, cy = 582;
  const side = (s: Side, cx: number, delay: number): Layer => ({ kind: 'phone', clip: s.clip, h: PH, map: hold(s.t, s.play ?? 0), rings: [],
    keys: [{ t: 0, x: cx, y: cy + 14, s: .98, o: 0 }, { t: .3 + delay, x: cx, y: cy + 14, s: .98, o: 0 }, { t: .9 + delay, x: cx, y: cy, s: 1, o: 1 }] });
  return { name, duration: d, capPos: 'split', tag: 'Karşılaştırma', side: 'compare', split: { title, left: left.label, right: right.label, leftTone: left.tone ?? 'off', rightTone: right.tone ?? 'on' },
    captions: [{ from: .6, to: d + 1, text: caption }],
    layers: [side(left, 480, 0), side(right, 1440, .15)] };
}

function scenes(): Scene[] {
  const list: Scene[] = [];
  // ===== Opening: the logo =====
  list.push({ name: 'a0-giris', duration: 8, card: introCard, toc: 'Giriş ve QR sipariş' });

  // ===== 1. Default settings: the guest orders =====
  const A = marks('a-siparis'), At = taps('a-siparis');
  list.push(guestScene('a1-siparis', 'a-siparis', .2, A.sent + 2.8, ['plus', 'sugar', 'add', 'cart', 'send'], at => [
    { from: 0, to: at(A.menu) + .3, step: 1, text: 'Misafir masadaki QR kodu<br>telefonun kamerasıyla okutur.' },
    { from: at(A.menu) + .4, to: at(At.plus.on), step: 2, text: 'Menü tarayıcıda açılır.<br>Uygulama yüklenmez.' },
    { from: at(At.plus.on), to: at(At.sugar.on), step: 3, text: 'Üründeki “+”<br>ürünü açar.' },
    { from: at(At.sugar.on), to: at(At.add.on), step: 3, text: 'Seçenek belirlenir:<br>şeker “Orta”.' },
    { from: at(At.add.on), to: at(At.cart.on), step: 3, text: '“Sepete ekle” ürünü<br>sepete koyar.' },
    { from: at(At.cart.on), to: at(At.send.on), step: 4, text: '“Sepetimi görüntüle”<br>sepeti açar.' },
    { from: at(At.send.on), to: at(A.sent), step: 5, text: '“Siparişi gönder” siparişi<br>işletmeye iletir.' },
    { from: at(A.sent), to: 999, step: 5, text: 'Sipariş alındı;<br>numarası ekranda görünür.' },
  ]));
  list.push(staffScene('a2-mutfak', 'a-mutfak', A.sent - 1.2, A.sent + 4.6, { frame: 'display', tag: 'İşletme tarafı <b>· Mutfak ekranı</b>' }, () => [
    { from: .2, to: 99, text: 'Varsayılan ayarlarda sipariş<br>mutfak ekranına hemen düşer.' },
  ]));
  list.push(guestScene('a3-siparislerim', 'a-siparis', At.track.on - .4, A.end - .2, ['track', 'order'], at => [
    { from: 0, to: at(At.order.on), step: 6, text: '“Siparişimi takip et”<br>“Siparişlerim”i açar.' },
    { from: at(At.order.on), to: 999, step: 6, text: 'Siparişin durumu ve<br>masanın hesabı burada görünür.' },
  ]));

  // ===== 2. Müşteri siparişini değiştirip iptal edebilsin =====
  const S = taps('a-ayar-sure'), Sm = marks('a-ayar-sure');
  list.push(ownerScene('b1-ayar-sure', 'a-ayar-sure', .1, Sm.end - .2, ['ayarlar', 'topic', '!toggle', '!seconds'], at => [
    { from: .2, to: at(S.ayarlar.on), text: 'Misafirin sipariş ekranı işletmenin ayarlarına göre değişir.' },
    { from: at(S.ayarlar.on), to: at(S.row.on), text: 'Ayarlar → Sipariş ve mutfak → Sipariş ve onay.' },
    { from: at(S.row.on), to: at(S.seconds.on), text: '“Müşteri siparişini değiştirip iptal edebilsin” açılır.' },
    { from: at(S.seconds.on), to: 999, text: 'Süre 30 saniye olarak gelir; 1–600 saniye arası yazılabilir.' },
  ], 'Ayar: sipariş değiştirme süresi'));
  const B = marks('b-degistir'), Bt = taps('b-degistir');
  list.push(guestScene('b2-degistir', 'b-degistir', .3, (Bt.cancel?.off ?? B.changed + 3) + .6, ['plus', 'add', 'cart', 'send', 'window', 'track', 'change', 'qty', 'save', 'cancel'], at => [
    { from: 0, to: at(Bt.send.on), step: 7, text: 'Ayar açıkken misafir<br>aynı siparişi verir.' },
    { from: at(Bt.send.on), to: at(Bt.window.on), step: 7, text: 'Sipariş gönderilir.' },
    { from: at(Bt.window.on), to: at(Bt.track.on), step: 7, text: 'Onay ekranı değiştirme<br>süresini gösterir: 30 sn.' },
    { from: at(Bt.track.on), to: at(Bt.change.on), step: 7, text: '“Siparişlerim”de “Siparişi<br>değiştir” geri sayımla görünür.' },
    { from: at(Bt.change.on), to: at(Bt.save.on), step: 7, text: 'Misafir adedi<br>2 yapar.' },
    { from: at(Bt.save.on), to: Bt.cancel ? at(Bt.cancel.on) : 999, step: 7, text: '“Değişiklikleri kaydet”<br>siparişi günceller.' },
    ...(Bt.cancel ? [{ from: at(Bt.cancel.on), to: 999, step: 7, text: 'Süre içinde “Siparişi iptal et”<br>de kullanılabilir.' }] : []),
  ]));
  list.push(staffScene('b3-mutfak', 'b-mutfak', B.kitchen - 1.6, B.kitchen + 4.4, { frame: 'display', tag: 'İşletme tarafı <b>· Mutfak ekranı</b>' }, () => [
    { from: .2, to: 99, text: 'Mutfak ekranı siparişi<br>süre dolunca alır.' },
  ]));
  list.push(splitScene('b4-karsilastirma', 'Müşteri siparişini değiştirip iptal edebilsin',
    { clip: 'a-siparis', t: At.order.on + .3, label: 'Varsayılan · kapalı' }, { clip: 'b-degistir', t: Bt.track.tap! + .9, label: 'Açık · 30 sn', play: Math.min(2.5, Bt.change.tap! - Bt.track.tap! - 1.1) },
    'Kapalıyken değiştirme düğmesi yoktur; açıkken süre boyunca görünür.'));

  // ===== 3. QR siparişlerinde garson onayı =====
  const O = taps('c-ayar-onay'), Om = marks('c-ayar-onay');
  list.push(ownerScene('c1-ayar-onay', 'c-ayar-onay', .1, Om.end - .2, ['ayarlar', 'topic', '!toggle'], at => [
    { from: .2, to: at(O.ayarlar.on), text: 'Sonraki örnekte değiştirme süresi kapalıdır.' },
    { from: at(O.ayarlar.on), to: at(O.row.on), text: 'Ayarlar → Sipariş ve mutfak → Sipariş ve onay.' },
    { from: at(O.row.on), to: 999, text: '“QR siparişlerinde garson onayı” açılır.' },
  ], 'Ayar: garson onayı'));
  const Cm = marks('c-onay'), Ct = taps('c-onay');
  list.push(guestScene('c2-onay-misafir', 'c-onay', .3, Ct.waiting.off! + .5, ['plus', 'add', 'cart', 'send', 'waiting'], at => [
    { from: 0, to: at(Ct.send.on), step: 8, text: 'Misafir siparişini<br>hazırlar.' },
    { from: at(Ct.send.on), to: at(Ct.waiting.on), step: 8, text: 'Sipariş gönderilir.' },
    { from: at(Ct.waiting.on), to: 999, step: 8, text: 'Sipariş önce garsonun<br>onayına gider.' },
  ]));
  const Gt = taps('c-garson');
  list.push(staffScene('c3-onay-tablet', 'c-garson', Gt.queue.on - 1.2, Gt.approve.tap! + 1.8, { frame: 'tablet', tag: 'İşletme tarafı <b>· Garson tableti</b>', taps: ['approve'] }, at => [
    { from: .2, to: at(Gt.approve.on), text: 'Garson tabletinde onay bekleyen sipariş görünür.' },
    { from: at(Gt.approve.on), to: 99, text: '“Onayla ve mutfağa gönder” siparişi mutfağa geçirir.' },
  ]));
  list.push(guestScene('c4-onay-misafir', 'c-onay', Cm.approved - .4, Ct.ok.off! + .2, ['ok'], () => [
    { from: .1, to: 999, step: 8, text: 'Misafirin ekranında<br>“Onaylandı, hazırlanıyor” yazar.' },
  ]));
  list.push(splitScene('c5-karsilastirma', 'QR siparişlerinde garson onayı',
    { clip: 'a-siparis', t: A.sent + 1.6, label: 'Varsayılan · kapalı' }, { clip: 'c-onay', t: Ct.waiting.on + .3, label: 'Açık' },
    'Kapalıyken sipariş doğrudan alınır; açıkken önce garson onaylar.'));

  // ===== 4. QR siparişlerini durdur =====
  const Q = taps('d-ayar-qr'), Qm = marks('d-ayar-qr');
  list.push(ownerScene('d1-durdur', 'd-ayar-qr', .1, Qm.guestFrom + .1, ['!card', 'stop', 'confirm'], at => [
    { from: .2, to: at(Q.stop.on), text: 'Kenar çubuğundaki kart QR siparişlerinin durumunu gösterir.' },
    { from: at(Q.stop.on), to: at(Q.confirm.on), text: '“Durdur” QR siparişlerini geçici olarak kapatır.' },
    { from: at(Q.confirm.on), to: at(Q.closed.on), text: 'Bir kez daha “Durdur” ile onaylanır.' },
    { from: at(Q.closed.on), to: 999, text: 'Kart “QR siparişleri kapalı” gösterir.' },
  ], 'Ayar: QR siparişlerini durdurma'));
  list[list.length - 1].tag = 'İşletme tarafı <b>· Kenar çubuğu</b>';
  const Dm = marks('d-durdu'), Dt = taps('d-durdu');
  list.push(guestScene('d2-durdu-misafir', 'd-durdu', .3, Dm.end - .2, ['plus', 'add', 'cart', 'notice', 'sendOff'], at => [
    { from: 0, to: at(Dt.cart.on), step: 9, text: 'Menü açık kalır;<br>ürün sepete eklenebilir.' },
    { from: at(Dt.cart.on), to: at(Dt.notice.on), step: 9, text: 'Misafir sepeti açar.' },
    { from: at(Dt.notice.on), to: 999, step: 9, text: 'Sepette “Şu an sipariş almıyoruz”<br>yazar; sipariş gönderilemez.' },
  ]));
  list.push(splitScene('d3-karsilastirma', 'QR siparişleri',
    { clip: 'a-siparis', t: At.send.on + .2, label: 'Açık', tone: 'on' }, { clip: 'd-durdu', t: Dt.sendOff.on + .3, label: 'Durduruldu', tone: 'off' },
    'Açıkken sipariş gönderilir; durdurulunca gönderilemez.'));
  list.push(ownerScene('d4-ac', 'd-ayar-qr', Qm.guestTo + .2, Qm.end - .2, ['reopen'], at => [
    { from: .2, to: 999, text: '“Siparişleri aç” QR siparişlerini yeniden açar.' },
  ]));
  list[list.length - 1].tag = 'İşletme tarafı <b>· Kenar çubuğu</b>';

  // ===== 5. Garson çağır, Hesabı iste =====
  const Em = marks('e-cagri'), Et = taps('e-cagri'), Wt = taps('e-garson'), Kt = taps('e-kasa');
  list.push(guestScene('e1-cagir', 'e-cagri', .3, Em.called + 1.8, ['call'], at => [
    { from: 0, to: at(Em.called), step: 10, text: '“Garson çağır”<br>garsona bildirim gönderir.' },
    { from: at(Em.called), to: 999, step: 10, text: 'Düğme “Garson çağrıldı”<br>olarak görünür.' },
  ], 'Garson çağırma ve hesap isteme'));
  list.push(staffScene('e2-cagri-tablet', 'e-garson', Wt.chip.on - 1, Wt.close.tap! + 1.6, { frame: 'tablet', tag: 'İşletme tarafı <b>· Garson tableti</b>', taps: ['close'] }, at => [
    { from: .2, to: at(Wt.close.on), text: 'Çağrı garson tabletinde masa adıyla görünür.' },
    { from: at(Wt.close.on), to: 99, text: 'Garson ilgilenince çağrıyı kapatır.' },
  ]));
  list.push(guestScene('e3-hesap', 'e-cagri', Em.billFrom - .2, Em.billAsked + 2, ['bill', 'card'], at => [
    { from: 0, to: at(Et.card.on), step: 11, text: '“Hesabı iste”: misafir<br>ödeme şeklini seçer.' },
    { from: at(Et.card.on), to: 999, step: 11, text: '“Kart” seçilir; düğme<br>“Hesap istendi” olur.' },
  ]));
  list.push(staffScene('e4-kasa', 'e-kasa', Kt.chip.on - 1, Kt.tile.off! + .4, { frame: 'window', title: 'Kasa ekranı', tag: 'İşletme tarafı <b>· Kasa ekranı</b>' }, at => [
    { from: .2, to: at(Kt.tile.on), text: 'İstek kasa ekranına düşer; ödeme şekli “Kart” yanında yazar.' },
    { from: at(Kt.tile.on), to: 99, text: 'Masanın kartında hesap isteği işareti görünür.' },
  ]));

  // ===== 6. QR kodlarını yazdır =====
  const Y = taps('f-yazdir'), Ym = marks('f-yazdir');
  list.push(ownerScene('f1-yazdir', 'f-yazdir', .1, Ym.end - .1, ['ayarlar', 'topic', 'part', '!a6'], at => [
    { from: .2, to: at(Y.a6.on), text: 'Ayarlar → Masalar ve QR → QR kodlarını yazdır.' },
    { from: at(Y.a6.on), to: at(Y.paper.on), text: 'Baskı: A4’e 6 ya da 12 QR ya da A6 masa standı.' },
    { from: at(Y.paper.on), to: 999, text: 'Masa standı A4’e 4’lü ya da A6 kâğıda tek basılır.' },
  ], 'QR kodlarını yazdırma'));
  list.push({ name: 'f2-baski', duration: 7, capPos: 'bottom', tag: 'İşletme tarafı <b>· Baskı</b>', side: 'business',
    captions: [{ from: .4, to: 9, text: 'Her masanın kodu, masa adıyla birlikte basılır.' }],
    layers: [
      { kind: 'image', src: img(join(REC, 'baski', 'a4-6.png')), w: 560, keys: [{ t: 0, x: 690, y: 500, s: .96, o: 0 }, { t: .5, x: 690, y: 500, s: 1, o: 1 }] },
      { kind: 'image', src: img(join(REC, 'baski', 'a6-stand.png')), w: 540, keys: [{ t: 0, x: 1250, y: 500, s: .96, o: 0 }, { t: .8, x: 1250, y: 500, s: .96, o: 0 }, { t: 1.3, x: 1250, y: 500, s: 1, o: 1 }] },
    ] });
  // ===== 7. The report: how much of the ordering is done by QR =====
  // The chart card runs below the screen's edge: the outline keeps to the donut and its legend.
  for (const t of meta('g-rapor').taps ?? []) if (t.name === 'donut') t.box = { ...t.box, height: Math.min(t.box.height, 330) };
  const R = taps('g-rapor'), Rm = marks('g-rapor');
  list.push(ownerScene('f3-rapor', 'g-rapor', .1, Rm.end - .1, ['rapor', 'range', 'detail', 'staff', '!donut'], at => [
    { from: .2, to: at(R.donut.on), text: 'Satış ve Raporlar → 30 gün → Personel.' },
    { from: at(R.donut.on), to: 999, text: 'Siparişlerinizin ne kadarını QR ile alıyorsunuz? 30 günde görün.' },
  ], 'Rapor: QR sipariş payı'));
  list[list.length - 1].tag = 'İşletme tarafı <b>· Raporlar</b>';
  list.push({ name: 'g0-son', duration: 7.5, card: endCard });
  return list;
}

// ---------- Rendering ----------
async function renderScene(browser: Browser, scene: Scene) {
  const htmlFile = join(WORK, `${scene.name}.html`); writeFileSync(htmlFile, stageHtml(scene));
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(htmlFile).href);
  await page.evaluate('document.fonts.ready');
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
/** Stills of each scene at a few moments (the layout check), or at the given times. */
async function sceneStills(browser: Browser, list: Scene[]) {
  const shots: string[] = [];
  mkdirSync(join(WORK, 'kare'), { recursive: true });
  for (const s of list) {
    const htmlFile = join(WORK, `${s.name}.html`); writeFileSync(htmlFile, stageHtml(s));
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlFile).href); await page.evaluate('document.fonts.ready');
    for (const k of [.2, .45, .7, .92]) {
      const t = s.duration * k; await page.evaluate(`renderAt(${t})`);
      const f = join(WORK, 'kare', `${s.name}-${Math.round(k * 100)}.jpg`);
      writeFileSync(f, await page.screenshot({ type: 'jpeg', quality: 80 })); shots.push(f);
    }
    await page.close();
  }
  return shots;
}
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const sceneLen = (s: Scene) => Math.round(s.duration * FPS) / FPS;

async function joinWithMusic(list: Scene[]) {
  const total = list.reduce((n, s) => n + sceneLen(s), 0);
  // Soft breaks in the music where a new part (YouTube chapter) begins.
  const starts: number[] = []; let t = 0;
  for (const s of list) { if (s.toc && t > 0) starts.push(t); t += sceneLen(s); }
  const wav = join(WORK, 'muzik.wav');
  const py = spawnSync('python', [join(ROOT, 'scripts', 'sosyal', 'muzik.py'), wav, total.toFixed(2), 'canli-uzun', starts.map(x => x.toFixed(2)).join(',')], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (py.status !== 0) throw new Error(`Müzik üretilemedi: ${py.stderr}`);
  // Background level: measured, then one gain to about -20 LUFS (the track is steady; no dynamic compression).
  const probe = spawnSync(FFMPEG, ['-hide_banner', '-i', wav, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const found = [...probe.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1);
  const lufs = Number(found?.[1]), gain = (-20 - lufs).toFixed(2);
  const listFile = join(WORK, 'parcalar.txt');
  writeFileSync(listFile, list.map(s => `file '${join(WORK, `${s.name}.mp4`).replace(/\\/g, '/')}'`).join('\n'));
  const mp4 = join(OUT, 'QR menü ve QR sipariş.mp4');
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
    '-af', `volume=${gain}dB,aresample=48000`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-shortest', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Birleştirme başarısız: ${r.stderr}`);
  console.log(`Video: ${mp4} · ${fmt(total)} · müzik ${lufs.toFixed(1)} LUFS → -20 (${gain} dB)`);
}

// ---------- Description and thumbnail ----------
function description(list: Scene[]) {
  let t = 0; const toc: [number, string][] = [];
  for (const s of list) { if (s.toc) toc.push([t, s.toc]); t += sceneLen(s); }
  toc.forEach(([x, name], i) => { const next = toc[i + 1]?.[0] ?? t; if (next - x < 10) throw new Error(`Bölüm 10 sn'den kısa: ${name}`); });
  if (toc[0][0] !== 0 || toc.length < 3) throw new Error('YouTube bölümleri 0:00’da başlamalı ve en az 3 olmalı.');
  const lines = toc.map(([x, name]) => `${fmt(x)} ${name}`);
  const title = 'QR menü ve QR sipariş: misafir, garson, mutfak ve ayarlar | Mola';
  if (title.length > 70) throw new Error(`Başlık ${title.length} karakter.`);
  const text = `BAŞLIK (${title.length} karakter)
${title}

AÇIKLAMA
Bu videoda Mola adisyon ve QR menü sisteminde QR menü ve QR siparişin nasıl çalıştığı adım adım gösteriliyor. Görüntüler uygulamanın kendisinden, örnek bir işletmeyle kaydedildi.

Önce varsayılan ayarlarla bir sipariş: masadaki QR kodun okutulması, menü, ürünün sepete eklenmesi, siparişin gönderilmesi, mutfak ekranı ve “Siparişlerim”.
Ardından misafirin ekranını değiştiren üç ayar; her biri için ayarın yeri, açılması, misafirin yeni ekranı ve önce / sonra karşılaştırması:
- Müşteri siparişini değiştirip iptal edebilsin (değiştirme süresi, 30 saniye)
- QR siparişlerinde garson onayı (garson tableti)
- QR siparişlerini durdurma
Son olarak “Garson çağır” ve “Hesabı iste” (Nakit / Kart) ile bunların garson tabletinde ve kasa ekranında görünmesi, masa QR kodlarının yazdırılması ve Satış ve Raporlar’da QR sipariş payı.

Bölümler
${lines.join('\n')}

Mola 30 gün ücretsiz denenebilir.
Web: https://molayazilim.com.tr
E-posta: destek@molayazilim.com.tr

ETİKETLER
QR menü, QR sipariş, adisyon programı, kafe adisyon, restoran adisyon, kafe yazılımı, masadan sipariş, dijital menü, garson çağırma, garson onayı, mutfak ekranı, kasa programı, Mola, Mola adisyon, Elazığ
`;
  writeFileSync(join(OUT, 'aciklama.txt'), text.replace(/\n/g, '\r\n'));
  console.log(lines.join('\n'));
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
  h1{font-weight:400;font-size:120px;line-height:1.0;letter-spacing:-.03em}
  .brand{display:flex;align-items:center;gap:16px;margin-top:46px;font-size:52px}.brand svg{border-radius:14px;box-shadow:0 0 0 2px rgba(243,235,221,.3)}.brand i{font-style:normal;color:${C.dot}}
  .phone{position:absolute;left:820px;top:52px;width:318px;height:672px;padding:12px;border-radius:44px;background:#1c2721;box-shadow:0 40px 80px -20px rgba(0,0,0,.55),inset 0 0 0 2px #3a4a41;transform:rotate(4deg)}
  .phone .screen{width:294px;height:636px;border-radius:33px;overflow:hidden;background:${C.paper}}.phone img{width:100%;display:block}
  .qr{position:absolute;left:744px;top:470px;width:120px;height:120px;border-radius:30px;background:${C.cup};display:grid;place-items:center;box-shadow:0 24px 50px -16px rgba(0,0,0,.55)}`);
}
async function thumbnail(browser: Browser) {
  // The menu as the guest sees it (a phone frame of the recording, top part).
  const m = meta('a-siparis'), mk = marks('a-siparis'), at = mk.menuReady + 2.2;
  const i = m.frames.findLastIndex(x => x.t - m.marks.start <= at);
  await sharp(join(REC, 'a-siparis', m.frames[i].file)).png().toFile(join(WORK, 'kapak-menu.png'));
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
  GUEST_STEPS = Math.max(...list.flatMap(s => (s.captions ?? []).map(c => c.step ?? 0)));
  const pick = (s: Scene) => !only.length || only.includes(s.name) || only.some(o => s.name.startsWith(o));
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    if (stills) { const shots = await sceneStills(browser, list.filter(pick)); console.log(`${shots.length} kare: ${join(WORK, 'kare')}`); return; }
    if (!coverOnly) {
      const todo = list.filter(s => only.length ? pick(s) : !existsSync(join(WORK, `${s.name}.mp4`)) || !!process.env.HEPSI);
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
