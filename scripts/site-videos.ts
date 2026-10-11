/*
 * Web sitesi videoları (molayazilim.com.tr): short, silent, looping clips recorded from the REAL app with the demo business
 * ("Mola Örnek Kafe", scripts/demo-template.ts). Never real data: every run makes a fresh Mola Merkez and a fresh demo café
 * in .local/site-videolar/run-<zaman>/ and records them; nothing else is opened or touched.
 *
 *   npm.cmd run site:videos                  all clips
 *   npm.cmd run site:videos -- mutfak kasa   only these clips
 *   npm.cmd run site:videos -- --kesif       screenshots of the screens only (to write or fix a clip)
 *
 * Ports: café 3700, Mola Merkez 3790 (SITE_VIDEO_PORT / SITE_VIDEO_MERKEZ_PORT). Needs `npm run build` (served dist/).
 * Recording: Chrome's own screencast (CDP Page.startScreencast), frames with their timestamps, then the local ffmpeg
 * (FFMPEG, else ffmpeg on PATH, else C:\FFmpeg\bin\ffmpeg.exe) makes H.264 MP4 (yuv420p, High profile, faststart: plays on
 * iPhone Safari) and a JPEG poster. Output: site/src/assets/video/<ad>.mp4 + <ad>.jpg (+ videolar.json), and stills for the
 * page in site/src/assets/img/ekran-*.webp.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import QRCode from 'qrcode';
import sharp from 'sharp';

const ROOT = resolve('.');
const KAFE_PORT = Number(process.env.SITE_VIDEO_PORT ?? 3700), MERKEZ_PORT = Number(process.env.SITE_VIDEO_MERKEZ_PORT ?? 3790);
const KAFE = `http://127.0.0.1:${KAFE_PORT}`, MERKEZ = `http://127.0.0.1:${MERKEZ_PORT}`;
const PASSWORD = 'MolaDemo!2026', ADMIN_PASSWORD = 'Site-Video-Yesil-Bahce!26';
const VIDEO_OUT = join(ROOT, 'site', 'src', 'assets', 'video'), IMG_OUT = join(ROOT, 'site', 'src', 'assets', 'img');
const args = process.argv.slice(2), explore = args.includes('--kesif'), only = args.filter(a => !a.startsWith('--'));
// SITE_VIDEO_RUN: reuse an earlier run folder (no new demo business; its live floor has moved on since).
const reuse = process.env.SITE_VIDEO_RUN ? resolve(process.env.SITE_VIDEO_RUN) : undefined;
const run = reuse ?? join(ROOT, '.local', 'site-videolar', `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(run, { recursive: true });

function ffmpegPath() {
  for (const candidate of [process.env.FFMPEG, 'ffmpeg', 'C:\\FFmpeg\\bin\\ffmpeg.exe']) {
    if (!candidate) continue;
    const r = spawnSync(candidate, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.includes('libx264')) return candidate;
  }
  throw new Error('libx264 içeren bir ffmpeg bulunamadı (FFMPEG ortam değişkeniyle yolunu verin).');
}
const FFMPEG = ffmpegPath();

// ---------- Servers: a fresh Mola Merkez and a fresh demo café ----------
const children: ChildProcess[] = [];
const stopAll = () => { for (const c of children) if (c.exitCode === null && c.pid) { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); else c.kill(); } };
process.on('exit', stopAll);
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { stopAll(); process.exit(1); });
const quiet = { ...process.env, MOLA_AUTO_BACKUP: '0', MOLA_BACKUP_DISCOVERY: '0' };
async function waitFor(url: string, what: string) {
  for (let i = 0; i < 400; i++) { try { if ((await fetch(url)).ok) return; } catch { /* starting */ } await new Promise(r => setTimeout(r, 150)); }
  throw new Error(`${what} açılmadı.`);
}
async function startServers() {
  const merkezDir = join(run, 'merkez'), kafeDir = join(run, 'kafe');
  const merkez = spawn(process.execPath, ['--import', 'tsx', 'server/merkez/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...quiet, MERKEZ_PORT: String(MERKEZ_PORT), MERKEZ_DATA_DIR: merkezDir, SERVE_BUILD: '1', MERKEZ_INITIAL_PASSWORD: ADMIN_PASSWORD } });
  children.push(merkez);
  await waitFor(`${MERKEZ}/api/merkez/v1/health`, 'Mola Merkez');
  if (!reuse) console.log('Örnek işletme hazırlanıyor (birkaç dakika sürer)…');
  if (!reuse) {
    // 12 days of history: the generator's fake clock runs without Merkez's signed pulse, and the café closes new orders after
    // 14 days without one (server/kafe-link.ts OFFLINE_DAYS), so a longer history stops halfway.
    const demo = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/demo-template.ts', kafeDir, '--gun=12'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...quiet,
      // The generator keeps the owner's lock off while its fake clock jumps and holds off the real-clock jobs by itself (8 Ekim).
      MOLA_MERKEZ_URL: MERKEZ, MERKEZ_DATA_DIR: merkezDir, MERKEZ_ADMIN_PASSWORD: ADMIN_PASSWORD } });
    process.stdout.write(demo.stdout ?? '');
    if (!/Örnek işletme hazır:/.test(demo.stdout ?? '')) throw new Error('Örnek işletme hazırlanamadı.');
  }
  const kafe = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...quiet, PORT: String(KAFE_PORT), SERVE_BUILD: '1', DATA_DIR: kafeDir,
    // The demo folder has its own business ids (mola-demo-<8 hane>): without this the server would also seed the default
    // 'mola-demo' / 'other-demo' businesses, whose user names collide with the demo's (staff_login_lookup).
    MOLA_CLEAN_INSTALL: '1', MOLA_MERKEZ_URL: MERKEZ, MOLA_MERKEZ_PUBLIC_KEY: join(merkezDir, 'merkez-public-key.txt'), MOLA_SYNC_SOON_MS: '1000', MOLA_HEARTBEAT_MS: '2000' } });
  children.push(kafe);
  await waitFor(`${KAFE}/api/health`, 'Kafe sunucusu');
}

// ---------- Recording ----------
/** A soft ring where the finger (or the mouse) presses, and on computers a small pointer that glides: viewers see what was tapped. */
const POINTER = `(() => {
  const css = '.mola-tap{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(35,76,62,.22);border:2px solid rgba(35,76,62,.6);pointer-events:none;z-index:2147483647;animation:mola-tap .6s ease-out forwards}@keyframes mola-tap{from{transform:scale(.35);opacity:1}to{transform:scale(1.35);opacity:0}}.mola-cursor{position:fixed;left:0;top:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;transition:transform .08s linear}';
  const add = () => {
    if (document.getElementById('mola-pointer-css')) return;
    const s = document.createElement('style'); s.id = 'mola-pointer-css'; s.textContent = css; document.documentElement.appendChild(s);
    if (window.__molaCursor) { const c = document.createElement('div'); c.className = 'mola-cursor'; c.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l15 11-7 1-3 7z" fill="#24382e" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'; c.style.transform = 'translate(-40px,-40px)'; document.documentElement.appendChild(c);
      addEventListener('mousemove', e => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true); }
  };
  addEventListener('pointerdown', e => { const d = document.createElement('div'); d.className = 'mola-tap'; d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; document.documentElement.appendChild(d); setTimeout(() => d.remove(), 650); }, true);
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
})()`;

type Frame = { file: string; t: number };
type Kind = 'phone' | 'desktop';
const VIEWPORTS: Record<Kind, { width: number; height: number; scale: number; out: number }> = {
  phone: { width: 390, height: 844, scale: 1.25, out: 480 },
  // A small computer screen (16:10) at 1.25×: on the page the video is shown about 600 px wide, so its text must not be tiny.
  desktop: { width: 1024, height: 640, scale: 1.25, out: 1280 },
};
async function newContext(browser: Browser, kind: Kind) {
  const v = VIEWPORTS[kind];
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.scale, isMobile: kind === 'phone', hasTouch: kind === 'phone', locale: 'tr-TR', timezoneId: 'Europe/Istanbul', colorScheme: 'light', reducedMotion: 'no-preference' });
  await ctx.addInitScript(`window.__molaCursor = ${kind === 'desktop'};${POINTER}`);
  return ctx;
}
class Recorder {
  frames: Frame[] = []; private dir: string; private stopped = false; private n = 0; private session?: Awaited<ReturnType<BrowserContext['newCDPSession']>>; startedAt = 0;
  constructor(private page: Page, private name: string) { this.dir = join(run, 'kareler', name); mkdirSync(this.dir, { recursive: true }); }
  enabled = true;
  async start() {
    if (!this.enabled) return;
    this.session = await this.page.context().newCDPSession(this.page);
    this.session.on('Page.screencastFrame', async (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      if (this.stopped) return;
      const file = join(this.dir, `f${String(++this.n).padStart(5, '0')}.jpg`);
      writeFileSync(file, Buffer.from(f.data, 'base64'));
      this.frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
      try { await this.session!.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch { /* stopped */ }
    });
    await this.session.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
    this.startedAt = Date.now() / 1000;
  }
  async stop() {
    const end = Date.now() / 1000;
    await this.session!.send('Page.stopScreencast').catch(() => {});
    this.stopped = true;
    return encode(this.name, this.frames, end, VIEWPORTS[this.kind].out);
  }
  kind: Kind = 'desktop';
}
const fmt = (n: number) => n.toFixed(4);
async function encode(name: string, frames: Frame[], end: number, width: number) {
  if (frames.length < 2) throw new Error(`${name}: kare kaydedilmedi.`);
  const list = [`ffconcat version 1.0`];
  for (let i = 0; i < frames.length; i++) {
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    list.push(`file '${frames[i].file.replace(/\\/g, '/')}'`, `duration ${fmt(Math.max(0.001, next - frames[i].t))}`);
  }
  list.push(`file '${frames.at(-1)!.file.replace(/\\/g, '/')}'`);
  const listFile = join(run, `${name}.ffconcat`); writeFileSync(listFile, list.join('\n'));
  const total = end - frames[0].t, fade = 0.35;
  mkdirSync(VIDEO_OUT, { recursive: true });
  const mp4 = join(VIDEO_OUT, `${name}.mp4`);
  // JPEG frames are full-range BT.601: converted to limited-range BT.709 and tagged so (Safari, iPhone and Android agree on colours).
  const vf = `fps=30,scale=${width}:-2:flags=lanczos:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p,fade=t=in:st=0:d=${fade}:color=0xf6f7f4,fade=t=out:st=${fmt(total - fade)}:d=${fade}:color=0xf6f7f4`;
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', vf, '-t', fmt(total), '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '28', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', '-an', mp4], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${name}: ffmpeg başarısız.`);
  // Poster: a frame a little after the middle (the screen is settled there), JPEG for every browser and WebP.
  const still = frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.6))].file;
  const poster = sharp(readFileSync(still)).resize({ width });
  writeFileSync(join(VIDEO_OUT, `${name}.jpg`), await poster.jpeg({ quality: 72, mozjpeg: true }).toBuffer());
  const kb = Math.round(statSync(mp4).size / 1024);
  console.log(`  ${name}.mp4 · ${total.toFixed(1)} sn · ${kb} KB`);
  return { name, seconds: total, kb };
}

// ---------- Helpers for the clips ----------
const pause = (page: Page, ms: number) => page.waitForTimeout(ms);
/** Moves the (visible) pointer to the element, then presses it. */
async function press(page: Page, target: Locator, o: { hold?: number } = {}) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 }); await pause(page, 160); }
  await target.click();
  await pause(page, o.hold ?? 450);
}
async function typeSlow(page: Page, target: Locator, text: string) { await press(page, target, { hold: 150 }); await target.pressSequentially(text, { delay: 90 }); await pause(page, 300); }
async function login(page: Page, username: string) {
  await page.goto(`${KAFE}/`);
  await page.getByLabel('Kullanıcı adı', { exact: true }).fill(username);
  await page.getByLabel('Şifre', { exact: true }).fill(PASSWORD);
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/login')), page.getByRole('button', { name: 'Çalışma alanını aç' }).click()]);
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => {});
  await pause(page, 800);
  // The demo owner has not accepted the Mola Lisans Sözleşmesi yet: accepted once, before anything is recorded.
  const agree = page.getByRole('button', { name: 'Okudum, kabul ediyorum' });
  if (await agree.isVisible().catch(() => false)) { await agree.click(); await pause(page, 800); }
}
async function smoothScroll(page: Page, by: number, ms = 900) {
  // A string, not a function: tsx adds __name() helpers to functions, which do not exist inside the page.
  await page.evaluate(`new Promise(function (done) { var start = scrollY, t0 = performance.now(); function step(t) { var k = Math.min(1, (t - t0) / ${ms}), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; scrollTo(0, start + ${by} * e); if (k < 1) requestAnimationFrame(step); else done(); } requestAnimationFrame(step); })`);
}
type StaffState = { tables: { id: string; name: string; token: string; account: unknown; needsCleaning?: boolean }[] };
/** A table nobody sits at and that is clean (a guest there could order now). */
const freeTable = (s: StaffState, prefer?: RegExp) => (prefer && s.tables.find(t => !t.account && !t.needsCleaning && prefer.test(t.name))) || s.tables.find(t => !t.account && !t.needsCleaning) || s.tables.find(t => !t.account)!;
async function ownerState(browser: Browser): Promise<StaffState> {
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await login(p, 'isletme');
  const s = await (await p.request.get(`${KAFE}/api/staff/state`)).json() as StaffState;
  await ctx.close();
  return s;
}
async function shot(page: Page, file: string, o: { fullPage?: boolean; width?: number } = {}) {
  await page.evaluate(`document.querySelectorAll('.mola-cursor, .mola-tap').forEach(function (e) { e.remove(); })`);
  const png = await page.screenshot({ fullPage: o.fullPage ?? false });
  mkdirSync(IMG_OUT, { recursive: true });
  // Through a buffer: a running `npm run site:dev` may hold the old file open for a moment (Windows).
  writeFileSync(join(IMG_OUT, `${file}.webp`), await sharp(png).resize({ width: o.width ?? 1400, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer());
  if (explore) writeFileSync(join(run, `${file}.png`), png);
}

// ---------- The clips ----------
type Clip = { name: string; kind: Kind; caption: string; play: (page: Page, browser: Browser, rec: Recorder) => Promise<void> };
const clips: Clip[] = [];
const clip = (name: string, kind: Kind, caption: string, play: Clip['play']) => clips.push({ name, kind, caption, play });

// 1. Müşteri: masadaki QR → menü → sepete ekle → sipariş gönder
clip('qr-siparis', 'phone', 'Müşteri masadaki QR kodu okutur, menü açılır, siparişini verir.', async (page, browser, rec) => {
  const s = await ownerState(browser);
  const table = freeTable(s, /0?5$/);
  const url = `${KAFE}/m/${table.token}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#1d2b24', light: '#ffffff' } });
  await page.setContent(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
    body{margin:0;height:100vh;display:grid;place-items:center;background:linear-gradient(160deg,#cdbfa8,#b39c7f);font-family:Georgia,serif;overflow:hidden}
    .stand{width:300px;background:#fff;border-radius:20px;padding:24px 22px 20px;text-align:center;box-shadow:0 24px 50px rgba(40,30,20,.35);transform:rotate(-3deg)}
    .stand small{display:block;font:600 12px/1.3 Arial,sans-serif;letter-spacing:2px;color:#7b827b;text-transform:uppercase}
    .stand h1{margin:6px 0 12px;font-weight:400;font-size:27px;color:#234c3e}
    .stand img{width:220px;height:220px;display:block;margin:0 auto}
    .stand b{display:block;font:800 38px/1 Arial,sans-serif;color:#1d2b24;margin-top:12px}
    .stand p{font:13px/1.4 Arial,sans-serif;color:#556;margin:8px 0 0}
    .finder{position:fixed;inset:0;display:grid;place-items:center;pointer-events:none}
    .box{width:280px;height:280px;position:relative;opacity:0;animation:in .5s .9s forwards}
    .box i{position:absolute;width:40px;height:40px;border:4px solid #fff;border-radius:6px}
    .box i:nth-child(1){left:0;top:0;border-right:0;border-bottom:0}.box i:nth-child(2){right:0;top:0;border-left:0;border-bottom:0}
    .box i:nth-child(3){left:0;bottom:0;border-right:0;border-top:0}.box i:nth-child(4){right:0;bottom:0;border-left:0;border-top:0}
    .line{position:absolute;left:8px;right:8px;height:3px;background:#7cc3a4;box-shadow:0 0 12px #7cc3a4;top:10px;animation:scan 1.1s 1.2s ease-in-out 2 alternate}
    .pill{position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:rgba(20,32,26,.82);color:#fff;font:600 14px Arial,sans-serif;padding:11px 18px;border-radius:999px;opacity:0;animation:in .4s 2.4s forwards;white-space:nowrap}
    @keyframes in{to{opacity:1}}@keyframes scan{to{top:264px}}
  </style></head><body><div class="stand"><small>Örnek Kafe</small><h1>Menü ve sipariş</h1><img src="${qr}" alt=""><b>${table.name.replace(/^Masa\s*/, 'MASA ')}</b><p>Menü ve sipariş için okutun</p></div>
  <div class="finder"><div class="box"><i></i><i></i><i></i><i></i><div class="line"></div></div></div><div class="pill">Menü açılıyor…</div></body></html>`);
  await rec.start();
  await pause(page, 3300);
  await page.goto(url);
  await page.getByRole('button', { name: /Türk Kahvesi/ }).first().waitFor();
  await pause(page, 1300);
  await smoothScroll(page, 260, 1100); await pause(page, 600);
  await press(page, page.getByRole('button', { name: /Türk Kahvesi/ }).first(), { hold: 900 });
  const sugar = page.getByRole('dialog').getByText(/Orta/).first();
  if (await sugar.isVisible().catch(() => false)) await press(page, sugar, { hold: 600 });
  await press(page, page.getByRole('button', { name: /Sepete ekle/ }), { hold: 800 });
  await press(page, page.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }), { hold: 1100 });
  await press(page, page.getByRole('button', { name: 'Siparişi gönder', exact: true }), { hold: 400 });
  await page.getByText(/Sipariş #\d+/).first().waitFor();
  await pause(page, 2600);
});

/** A waiter's order from an unseen browser (the clip shows where it lands). Returns the table name. */
async function waiterOrder(browser: Browser, codes: string[], tableName?: string) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 900 } }); const p = await ctx.newPage();
  await login(p, 'garson');
  const s = await (await p.request.get(`${KAFE}/api/staff/state`)).json() as StaffState;
  const table = tableName ? s.tables.find(t => t.name === tableName)! : freeTable(s);
  await p.goto(`${KAFE}/`); await pause(p, 500);
  const takeOrder = p.getByRole('button', { name: /^Sipariş al/ }).first();
  if (await takeOrder.isVisible().catch(() => false)) await takeOrder.click();
  await p.getByLabel('Sipariş masası').selectOption(table.id);
  for (const code of codes) {
    await p.getByRole('textbox', { name: 'Ürün ara' }).fill(code);
    await p.locator('.staff-card').first().click();
    await p.getByRole('button', { name: /Sepete ekle/ }).click();
  }
  await p.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await p.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await p.getByText(/Sipariş #\d+ mutfağa gönderildi/).waitFor();
  await ctx.close();
  return table.name;
}

// 2. Mutfak: yeni sipariş belirir → Hazırlamaya başla → Hazır
clip('mutfak', 'desktop', 'Sipariş mutfak ekranına düşer; aşçı hazırlar ve “Hazır” der.', async (page, browser, rec) => {
  await login(page, 'mutfak');
  await page.locator('.kitchen-bar').waitFor();
  await rec.start();
  await pause(page, 1800);
  const table = await waiterOrder(browser, ['50', '23']);
  const card = page.locator('article.kitchen-card').filter({ has: page.getByRole('heading', { name: table, exact: true }) }).last();
  await card.waitFor({ timeout: 15000 });
  await card.scrollIntoViewIfNeeded();
  await pause(page, 2000);
  await press(page, card.getByRole('button', { name: 'Hazırlamaya başla' }), { hold: 2200 });
  const moved = page.locator('article.kitchen-card').filter({ has: page.getByRole('heading', { name: table, exact: true }) }).last();
  await moved.scrollIntoViewIfNeeded();
  await press(page, moved.getByRole('button', { name: 'Hazır olarak işaretle' }), { hold: 2600 });
});

// 3. Garson telefonunda masalar ve sipariş
clip('garson', 'phone', 'Garson masaları telefonundan izler, siparişi birkaç dokunuşla alır.', async (page, _browser, rec) => {
  await login(page, 'garson');
  const bar = page.getByRole('navigation', { name: 'Alt menü' });
  await bar.getByRole('button', { name: /^Masalar/ }).click(); await pause(page, 800);
  await rec.start();
  await pause(page, 2000);
  await smoothScroll(page, 300, 1200); await pause(page, 900);
  await smoothScroll(page, -300, 900); await pause(page, 500);
  await press(page, bar.getByRole('button', { name: /^Sipariş al/ }), { hold: 1000 });
  const s = await (await page.request.get(`${KAFE}/api/staff/state`)).json() as StaffState;
  const free = freeTable(s);
  await page.getByLabel('Sipariş masası').selectOption(free.id); await pause(page, 700);
  await typeSlow(page, page.getByRole('textbox', { name: 'Ürün ara' }), '19');
  await press(page, page.locator('.staff-card').first(), { hold: 900 });
  await press(page, page.getByRole('button', { name: /Sepete ekle/ }), { hold: 700 });
  await page.getByRole('textbox', { name: 'Ürün ara' }).fill(''); await pause(page, 300);
  await typeSlow(page, page.getByRole('textbox', { name: 'Ürün ara' }), '42');
  await press(page, page.locator('.staff-card').first(), { hold: 900 });
  await press(page, page.getByRole('button', { name: /Sepete ekle/ }), { hold: 700 });
  await press(page, page.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }), { hold: 1100 });
  await press(page, page.getByRole('button', { name: 'Siparişi gönder', exact: true }), { hold: 300 });
  await page.getByText(/Sipariş #\d+ mutfağa gönderildi/).waitFor();
  await pause(page, 2400);
});

// 4. Kasa: hesap kapatma (nakit), yazar kasa yardımcısı
clip('kasa', 'desktop', 'Kasada hesap kapanır: nakit ya da kart, para üstü ve yazar kasaya girilecek tutar.', async (page, browser, rec) => {
  const table = await waiterOrder(browser, ['21', '21', '42']);
  await login(page, 'kasiyer');
  const opening = page.getByRole('form', { name: 'Kasa açılışı' });
  if (await opening.isVisible().catch(() => false)) { await opening.getByLabel('Açılış tutarı').fill('500'); await opening.getByRole('button', { name: 'Açılışı kaydet' }).click(); await pause(page, 800); }
  await rec.start();
  await pause(page, 1800);
  await press(page, page.locator('.table-card', { hasText: table }).first(), { hold: 1500 });
  await press(page, page.getByRole('button', { name: 'Ödeme al' }), { hold: 1200 });
  const pay = page.getByRole('dialog', { name: new RegExp(`${table} · Ödeme al`) });
  const cash = pay.getByRole('button', { name: 'Nakit', exact: true });
  if (await cash.isVisible().catch(() => false)) await press(page, cash, { hold: 500 });
  const given = pay.getByLabel('Alınan nakit (TL)');
  if (await given.isVisible().catch(() => false)) { await given.fill(''); await typeSlow(page, given, '300'); }
  await pause(page, 900);
  await press(page, pay.getByRole('button', { name: 'Ödemeyi kaydet' }), { hold: 600 });
  await page.getByText(/Hesap kapandı/).first().waitFor({ timeout: 10000 }).catch(() => {});
  await pause(page, 3800);
});

// 5. İşletme sahibi telefonunda rapor
clip('sahip-rapor', 'phone', 'İşletme sahibi bugünün satışını ve raporları telefonundan görür.', async (page, _browser, rec) => {
  await login(page, 'isletme');
  await page.goto(`${KAFE}/`); await pause(page, 600);
  await rec.start();
  await pause(page, 1200);
  const nav = page.getByRole('navigation', { name: 'Alt menü' });
  const direct = nav.getByRole('button', { name: /^Satış ve Raporlar|^Raporlar/ });
  if (await direct.count()) await press(page, direct.first(), { hold: 1200 });
  else { await press(page, nav.getByRole('button', { name: /^Daha fazla/ }), { hold: 900 }); await press(page, page.getByRole('dialog', { name: 'Daha fazla' }).getByRole('button', { name: /^Satış ve Raporlar/ }), { hold: 1200 }); }
  await pause(page, 1600);
  await smoothScroll(page, 360, 1400); await pause(page, 1500);
  await smoothScroll(page, 380, 1400); await pause(page, 1500);
  await smoothScroll(page, -740, 1200); await pause(page, 700);
  const week = page.getByRole('button', { name: '7 gün', exact: true });
  if (await week.isVisible().catch(() => false)) { await press(page, week, { hold: 2200 }); }
  await pause(page, 1200);
});

// 6. Raporlar: dönem ve yıl seçici, detaylı rapor
clip('rapor-yil', 'desktop', 'Raporlar: bugün, 7 gün, 30 gün ya da yıl seçin; ayrıntı, KDV dökümü, Excel ve PDF.', async (page, _browser, rec) => {
  await login(page, 'isletme');
  await page.goto(`${KAFE}/`); await pause(page, 500);
  await page.locator('.sidebar nav').getByRole('button', { name: /^Satış ve Raporlar/ }).click();
  await pause(page, 1200);
  await rec.start();
  await pause(page, 1600);
  await press(page, page.getByRole('button', { name: '30 gün', exact: true }), { hold: 1800 });
  const year = page.getByRole('button', { name: /^(Yıl|20\d\d)/ }).first();
  if (await year.isVisible().catch(() => false)) { await press(page, year, { hold: 1600 }); await page.keyboard.press('Escape'); await pause(page, 600); }
  const more = page.getByRole('button', { name: 'Detaylı göster' });
  if (await more.isVisible().catch(() => false)) await press(page, more, { hold: 1600 });
  await smoothScroll(page, 420, 1500); await pause(page, 1600);
  await smoothScroll(page, 420, 1500); await pause(page, 1800);
});

// 7. QR kartları ve sosyal medya
clip('qr-kartlari', 'desktop', 'Masa QR kartları ve “Bizi takip edin” kartı: indirin, yazdırın, masaya koyun.', async (page, _browser, rec) => {
  await login(page, 'isletme');
  await page.goto(`${KAFE}/`); await pause(page, 500);
  // Instagram for the card (the demo has none): saved before the recording, like an owner would have done once.
  await page.locator('.sidebar nav').getByRole('button', { name: /^Ayarlar/ }).click();
  await page.getByRole('navigation', { name: 'Ayarlar konuları' }).getByRole('button', { name: /^İşletme/ }).click();
  await page.getByRole('navigation', { name: 'İşletme bölümleri' }).getByRole('button', { name: /^Sosyal medya/ }).click();
  const card = page.getByRole('region', { name: 'Sosyal medya' }).first();
  const insta = page.getByLabel('Instagram', { exact: true });
  if (!(await insta.inputValue()).trim()) { await insta.fill('@ornekkafe'); await page.getByRole('button', { name: 'Bağlantıları kaydet' }).click(); await pause(page, 4000); }
  void card;
  await page.getByRole('navigation', { name: 'Ayarlar konuları' }).getByRole('button', { name: /^Masalar ve QR/ }).click();
  await pause(page, 800);
  await rec.start();
  await pause(page, 1200);
  const qrCard = page.getByRole('heading', { name: /Masa QR kodları/ }).first();
  await qrCard.scrollIntoViewIfNeeded(); await pause(page, 1200);
  const a6 = page.getByText(/A6 masa standı/).first();
  if (await a6.isVisible().catch(() => false)) await press(page, a6, { hold: 2600 });
  await page.getByRole('navigation', { name: 'Ayarlar konuları' }).getByRole('button', { name: /^İşletme/ }).click(); await pause(page, 400);
  await press(page, page.getByRole('navigation', { name: 'İşletme bölümleri' }).getByRole('button', { name: /^Sosyal medya/ }), { hold: 1200 });
  const qrButton = page.getByRole('button', { name: 'Instagram için QR oluştur' });
  await qrButton.waitFor({ timeout: 20000 });
  await press(page, qrButton, { hold: 3000 });
  await pause(page, 1200);
});

/** Stills for the page (hero and features), from the same demo business. */
clip('ekranlar', 'desktop', '', async (page, browser) => {
  await login(page, 'kasiyer');
  await page.goto(`${KAFE}/`); await pause(page, 1500);
  // A click on the page header unlocks the sounds (the "Ses kapalı" note goes away), as on a working counter.
  await page.mouse.click(600, 30); await pause(page, 600);
  await shot(page, 'ekran-masalar', { width: 1280 });
  const phone = await newContext(browser, 'phone'), p = await phone.newPage();
  const s = await (await page.request.get(`${KAFE}/api/staff/state`)).json() as StaffState;
  await p.goto(`${KAFE}/m/${freeTable(s).token}`);
  await p.getByRole('button', { name: /Türk Kahvesi/ }).first().waitFor(); await pause(p, 1200);
  await shot(p, 'ekran-menu', { width: 488 });
  await phone.close();
});

async function main() {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    await startServers();
    const chosen = only.length ? clips.filter(c => only.includes(c.name)) : clips;
    // videolar.json (read by scripts/site-build.ts) is updated after every clip, so a later failure keeps what was made.
    const remember = (r: { name: string; seconds: number; kb: number; caption: string; kind: Kind }) => {
      const index = join(VIDEO_OUT, 'videolar.json'), old = existsSync(index) ? JSON.parse(readFileSync(index, 'utf8')) as { name: string }[] : [];
      const merged = [...old.filter(o => o.name !== r.name), r].sort((a, b) => clips.findIndex(c => c.name === a.name) - clips.findIndex(c => c.name === b.name));
      writeFileSync(index, JSON.stringify(merged, null, 2) + '\n');
    };
    for (const c of chosen) {
      console.log(`Kayıt: ${c.name}`);
      const ctx = await newContext(browser, c.kind), page = await ctx.newPage();
      // Each clip starts the recording itself once its screen is ready (sign-in and preparation stay out of the video).
      const rec = new Recorder(page, c.name); rec.kind = c.kind; rec.enabled = !explore && !!c.caption;
      try { await c.play(page, browser, rec); }
      catch (e) { await page.screenshot({ path: join(run, `hata-${c.name}.png`) }).catch(() => {}); console.error(`  ${c.name}: ekran görüntüsü ${join(run, `hata-${c.name}.png`)}`); throw e; }
      if (rec.enabled) remember({ ...(await rec.stop()), caption: c.caption, kind: c.kind });
      await ctx.close();
    }
  } finally {
    await browser.close();
    stopAll();
    if (!process.env.SITE_VIDEO_KEEP) rmSync(join(run, 'kareler'), { recursive: true, force: true });
  }
}
await main();
