/*
 * Instagram blok 1 (QR menü ve sipariş): recordings of the REAL app for the three videos and the phone screenshot of post 7.
 * Never real data: every run makes a fresh Mola Merkez and a fresh demo café ("Mola Örnek Kafe", scripts/demo-template.ts)
 * in .local/sosyal/blok1/run-<zaman>/, gives its menu the template photos (templates/gorseller) the way an owner uploads a
 * photo, and records the guest's phone. Nothing else is opened or touched.
 *
 *   npx tsx scripts/sosyal/blok1-kayit.ts                     all recordings + screenshots
 *   npx tsx scripts/sosyal/blok1-kayit.ts siparis garson      only these clips (siparis, garson, hesap, ekran)
 *   npx tsx scripts/sosyal/blok1-kayit.ts --sunucu            only start + prepare the servers and keep them open (Ctrl+C)
 *   SOSYAL_RUN=<run klasörü> …                                 reuse an earlier demo business (faster; no new history)
 *
 * Ports: café 3720, Mola Merkez 3796. Needs `npm run build` (served dist/).
 * Recording: Chrome's own screencast (CDP Page.startScreencast) of a 390×844 phone at 3× (sharp text), JPEG frames with their
 * timestamps plus named marks, in .local/sosyal/blok1/kayit/<klip>/ (meta.json). scripts/sosyal/blok1-kurgu.ts makes the posts.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import QRCode from 'qrcode';

const ROOT = resolve('.');
const KAFE_PORT = 3720, MERKEZ_PORT = 3796;
const KAFE = `http://127.0.0.1:${KAFE_PORT}`, MERKEZ = `http://127.0.0.1:${MERKEZ_PORT}`;
const PASSWORD = 'MolaDemo!2026', ADMIN_PASSWORD = 'Sosyal-Blok-Yesil-Fincan!26';
const OUT = join(ROOT, '.local', 'sosyal', 'blok1', 'kayit');
const args = process.argv.slice(2), serverOnly = args.includes('--sunucu'), only = args.filter(a => !a.startsWith('--'));
const reuse = process.env.SOSYAL_RUN ? resolve(process.env.SOSYAL_RUN) : undefined;
const run = reuse ?? join(ROOT, '.local', 'sosyal', 'blok1', `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(run, { recursive: true });

// ---------- Servers: a fresh Mola Merkez and a fresh demo café (as scripts/site-videos.ts) ----------
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
  if (!reuse) {
    console.log('Örnek işletme hazırlanıyor…');
    const demo = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/demo-template.ts', kafeDir, '--gun=5'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...quiet,
      MOLA_MERKEZ_URL: MERKEZ, MERKEZ_DATA_DIR: merkezDir, MERKEZ_ADMIN_PASSWORD: ADMIN_PASSWORD } });
    if (!/Örnek işletme hazır:/.test(demo.stdout ?? '')) { process.stdout.write(demo.stdout ?? ''); throw new Error('Örnek işletme hazırlanamadı.'); }
  }
  const kafe = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...quiet, PORT: String(KAFE_PORT), SERVE_BUILD: '1', DATA_DIR: kafeDir,
    MOLA_CLEAN_INSTALL: '1', MOLA_MERKEZ_URL: MERKEZ, MOLA_MERKEZ_PUBLIC_KEY: join(merkezDir, 'merkez-public-key.txt'), MOLA_SYNC_SOON_MS: '1000', MOLA_HEARTBEAT_MS: '2000' } });
  children.push(kafe);
  await waitFor(`${KAFE}/api/health`, 'Kafe sunucusu');
}

// ---------- The demo menu with photos ----------
type Product = { id: string; code: string; name: string; nameEn: string; category: string; subtype?: string; description: string; ingredients?: string; price: number; soldOut: boolean; art: string; photo?: string | null; groups: unknown[]; published?: boolean; unit?: string; readyMade?: boolean; vatRate?: number };
type StaffState = { revision: number; products: Product[]; tables: { id: string; name: string; token: string; account: unknown; needsCleaning?: boolean }[]; commissionBps?: number | null; changeSeconds?: number };
/** Template photo (templates/gorseller/<ad>.webp) for each product of the demo café; the others are taken off the guest menu. */
const PHOTOS: Record<string, string> = {
  'Caffè Latte': 'latte', 'Americano': 'americano', 'Türk Kahvesi': 'turkish', 'Demleme Çay': 'tea', 'Ihlamur': 'herbal',
  'Ev Yapımı Limonata': 'lemonade', 'Ayran': 'r-ayran', 'San Sebastian': 'cheesecake', 'Çikolatalı Brownie': 'brownie',
  'Fırın Sütlaç': 'd-sutlac', 'Künefe': 'r-kunefe', 'Fıstıklı Baklava': 'd-fistikli', 'Profiterol': 'd-profiterol', 'Kazandibi': 'd-kazandibi',
};
const EXTRA = [
  { code: '61', name: 'Fıstıklı Baklava', nameEn: 'Pistachio Baklava', category: 'Tatlılar', subtype: 'Şerbetli tatlılar', price: 24000, art: 'cake', description: 'İnce yufka, bol Antep fıstığı; porsiyonu dört dilim.', ingredients: 'Yufka, Antep fıstığı, tereyağı, şerbet' },
  { code: '62', name: 'Profiterol', nameEn: 'Profiteroles', category: 'Tatlılar', subtype: 'Sütlü tatlılar', price: 15000, art: 'cake', description: 'Kremalı top hamurlar, üzerinde sıcak çikolata sosu.', ingredients: 'Hamur, krema, bitter çikolata' },
  { code: '63', name: 'Kazandibi', nameEn: 'Kazandibi', category: 'Tatlılar', subtype: 'Sütlü tatlılar', price: 12500, art: 'cake', description: 'Altı karamelize, tarçınla servis edilir.', ingredients: 'Süt, pirinç unu, şeker, tarçın' },
];
const fields = (p: Product) => ({ ...(p.unit ? { unit: p.unit } : {}), ...(p.readyMade !== undefined ? { readyMade: p.readyMade } : {}), ...(p.vatRate !== undefined ? { vatRate: p.vatRate } : {}), code: p.code, name: p.name, nameEn: p.nameEn, category: p.category, subtype: p.subtype, description: p.description, ingredients: p.ingredients, price: p.price, soldOut: p.soldOut, art: p.art, photo: p.photo ?? null, groups: p.groups });
async function post(req: APIRequestContext, path: string, data: unknown) {
  const r = await req.post(`${KAFE}${path}`, { data });
  if (!r.ok()) throw new Error(`${path}: ${r.status()} ${await r.text()}`);
  return r.json();
}
const state = async (req: APIRequestContext) => (await (await req.get(`${KAFE}/api/staff/state`)).json()) as StaffState;
async function prepareMenu(browser: Browser) {
  const ctx = await browser.newContext(), page = await ctx.newPage(), req = page.request;
  await login(page, 'isletme');
  let s = await state(req);
  // QR orders go straight to the kitchen (after the guest's change window), as in most cafés: "Siparişiniz alındı".
  await post(req, '/api/staff/settings', { waiterApproval: false, changeSeconds: s.changeSeconds ?? 60, commissionBps: s.commissionBps ?? null });
  // No "… dakikadır yeni sipariş yok" reminders on the waiter's phone during the clips (the demo's floor is hours old).
  await post(req, '/api/staff/table-reminder', { minutes: 0 });
  for (const e of EXTRA) if (!s.products.some(p => p.name === e.name)) await post(req, '/api/staff/products', { product: { ...e, soldOut: false, photo: null, groups: [] } });
  s = await state(req);
  for (const p of s.products) {
    const photo = PHOTOS[p.name];
    if (photo && !p.photo) {
      // Upload like the product editor does (a WebP data URL); at most 20 a minute per user.
      const data = `data:image/webp;base64,${readFileSync(join(ROOT, 'templates', 'gorseller', `${photo}.webp`)).toString('base64')}`;
      const saved = await post(req, '/api/staff/photos', { data }) as { photo?: string; url?: string; path?: string };
      const url = saved.photo ?? saved.url ?? saved.path;
      if (!url) throw new Error(`Fotoğraf yanıtı beklenmedik: ${JSON.stringify(saved)}`);
      const fresh = (await state(req)).products.find(x => x.id === p.id)!;
      await post(req, '/api/staff/products', { id: p.id, product: { ...fields(fresh), photo: url, soldOut: false } });
    }
  }
  s = await state(req);
  for (const p of s.products) if (!PHOTOS[p.name] && p.published !== false) {
    const fresh = await state(req);
    const body = { requestId: randomUUID(), revision: fresh.revision, action: 'unpublish', id: p.id, product: { ...fields(p), published: false } };
    try { await post(req, '/api/staff/products', body); } catch (e) { console.error(JSON.stringify(body)); throw e; }
  }
  s = await state(req);
  console.log(`Menü: ${s.products.filter(p => p.published !== false).map(p => `${p.name}${p.photo ? '' : ' (fotoğrafsız)'}`).join(', ')}`);
  await ctx.close();
}

// ---------- Recording ----------
/** A fingertip that glides to what is tapped and a ring where it presses: viewers see what was touched. */
const POINTER = `(() => {
  const css = '.mola-finger{position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(22,51,40,.28);border:2px solid rgba(255,255,255,.85);box-shadow:0 2px 10px rgba(22,51,40,.35);pointer-events:none;z-index:2147483647;opacity:0;transition:opacity .25s,transform .12s}.mola-finger.on{opacity:1}.mola-finger.down{transform:scale(.8)}.mola-tap{position:fixed;width:60px;height:60px;margin:-30px 0 0 -30px;border-radius:50%;border:3px solid rgba(185,104,68,.9);pointer-events:none;z-index:2147483647;animation:mola-tap .55s ease-out forwards}@keyframes mola-tap{from{transform:scale(.4);opacity:1}to{transform:scale(1.5);opacity:0}}';
  let finger, timer;
  const add = () => {
    if (document.getElementById('mola-pointer-css')) return;
    const s = document.createElement('style'); s.id = 'mola-pointer-css'; s.textContent = css; document.documentElement.appendChild(s);
    finger = document.createElement('div'); finger.className = 'mola-finger'; document.documentElement.appendChild(finger);
  };
  const show = (x, y) => { if (!finger || window.__molaNoFinger) return; finger.style.left = x + 'px'; finger.style.top = y + 'px'; finger.classList.add('on'); clearTimeout(timer); timer = setTimeout(() => finger.classList.remove('on'), 900); };
  addEventListener('mousemove', e => show(e.clientX, e.clientY), true);
  addEventListener('pointerdown', e => { show(e.clientX, e.clientY); finger && finger.classList.add('down'); if (window.__molaNoFinger) return; const d = document.createElement('div'); d.className = 'mola-tap'; d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; document.documentElement.appendChild(d); setTimeout(() => d.remove(), 600); }, true);
  addEventListener('pointerup', () => { finger && finger.classList.remove('down'); }, true);
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
})()`;
const PHONE = { width: 390, height: 844, scale: 3 };
const DESKTOP = { width: 1280, height: 800, scale: 2 };
/** Chrome's screencast sends frames at the window's own scale, not the emulated one: each kind of screen gets a Chrome whose
 * scale is forced (--force-device-scale-factor), so the frames are 3× (phone) and 2× (desktop) like the screenshots. */
let deskBrowser: Browser;
async function phoneContext(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: PHONE.width, height: PHONE.height }, deviceScaleFactor: PHONE.scale, isMobile: false, hasTouch: true, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', colorScheme: 'light', reducedMotion: 'no-preference' });
  await ctx.addInitScript(POINTER);
  return ctx;
}
async function desktopContext(_browser: Browser) {
  return deskBrowser.newContext({ viewport: { width: DESKTOP.width, height: DESKTOP.height }, deviceScaleFactor: DESKTOP.scale, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', colorScheme: 'light' });
}
type Frame = { file: string; t: number };
class Recorder {
  frames: Frame[] = []; marks: Record<string, number> = {}; private n = 0; private stopped = false; private session?: Awaited<ReturnType<BrowserContext['newCDPSession']>>;
  constructor(private page: Page, readonly dir: string, readonly size: { width: number; height: number; scale: number }) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); }
  async start() {
    this.session = await this.page.context().newCDPSession(this.page);
    this.session.on('Page.screencastFrame', async (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      if (this.stopped) return;
      const name = `f${String(++this.n).padStart(5, '0')}.jpg`;
      writeFileSync(join(this.dir, name), Buffer.from(f.data, 'base64'));
      this.frames.push({ file: name, t: f.metadata.timestamp ?? Date.now() / 1000 });
      try { await this.session!.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch { /* stopped */ }
    });
    const w = this.size.width * this.size.scale, h = this.size.height * this.size.scale;
    await this.session.send('Page.startScreencast', { format: 'jpeg', quality: 94, maxWidth: w, maxHeight: h, everyNthFrame: 1 });
    this.mark('start');
  }
  mark(name: string) { this.marks[name] = Date.now() / 1000; }
  async stop() {
    this.mark('end');
    await this.session?.send('Page.stopScreencast').catch(() => {});
    this.stopped = true;
    writeFileSync(join(this.dir, 'meta.json'), JSON.stringify({ size: this.size, frames: this.frames, marks: this.marks }, null, 1));
    console.log(`  ${this.dir}: ${this.frames.length} kare, ${(this.marks.end - this.marks.start).toFixed(1)} sn`);
  }
}

// ---------- Helpers ----------
const pause = (page: Page, ms: number) => page.waitForTimeout(ms);
async function press(page: Page, target: Locator, o: { hold?: number } = {}) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 }); await pause(page, 220); }
  await target.click();
  await pause(page, o.hold ?? 450);
}
async function login(page: Page, username: string) {
  await page.goto(`${KAFE}/`);
  await page.getByLabel('Kullanıcı adı', { exact: true }).fill(username);
  await page.getByLabel('Şifre', { exact: true }).fill(PASSWORD);
  await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/login')), page.getByRole('button', { name: 'Çalışma alanını aç' }).click()]);
  await page.reload();
  await page.waitForLoadState('networkidle').catch(() => {});
  await pause(page, 800);
  const agree = page.getByRole('button', { name: 'Okudum, kabul ediyorum' });
  if (await agree.isVisible().catch(() => false)) { await agree.click(); await pause(page, 800); }
}
async function smoothScroll(page: Page, by: number, ms = 900) {
  await page.evaluate(`new Promise(function (done) { var start = scrollY, t0 = performance.now(); function step(t) { var k = Math.min(1, (t - t0) / ${ms}), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; scrollTo(0, start + ${by} * e); if (k < 1) requestAnimationFrame(step); else done(); } requestAnimationFrame(step); })`);
}
/** A clean table nobody sits at; `used` keeps each clip on its own table. */
const used = new Set<string>();
async function freeTable(browser: Browser) {
  const ctx = await browser.newContext(), p = await ctx.newPage();
  await login(p, 'isletme');
  const s = await state(p.request);
  await ctx.close();
  const t = s.tables.find(t => !t.account && !t.needsCleaning && !used.has(t.id) && /^Masa \d+$/.test(t.name)) ?? s.tables.find(t => !t.account && !used.has(t.id))!;
  used.add(t.id);
  return t;
}
const guestUrl = (token: string) => `${KAFE}/m/${token}`;
async function openMenu(page: Page, token: string) {
  await page.goto(guestUrl(token));
  await page.getByRole('button', { name: /Türk Kahvesi/ }).first().waitFor();
  // The photos on screen loaded before anything is recorded.
  await imagesOnScreen(page);
  await pause(page, 600);
}
/** Waits for the photos on screen (the others load lazily, only when scrolled to). */
async function imagesOnScreen(page: Page) {
  await page.waitForFunction(`[...document.images].filter(function (i) { var r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).every(function (i) { return i.complete && i.naturalWidth > 0; })`, undefined, { timeout: 15000 }).catch(() => {});
}
/** A staff screen that sees the guests (the café's rule: QR orders and calls need one connected). */
async function staffScreen(browser: Browser, user: string, kind: 'phone' | 'desktop', finger = false) {
  const ctx = kind === 'phone' ? await phoneContext(browser) : await desktopContext(browser);
  const page = await ctx.newPage();
  // No finger on the staff screen; Mola Yardım's one-time hint stays closed (as in playwright.config.ts).
  await page.addInitScript(`${finger ? '' : 'window.__molaNoFinger = true;'} try { localStorage.setItem('mola-yardim-ipucu', 'off'); localStorage.setItem('mola-campaign-ended', 'off'); } catch (e) {}`);
  await login(page, user);
  await page.goto(`${KAFE}/`); await pause(page, 1200);
  // A click on the page header unlocks the sounds (the "Ses kapalı" note goes away), as on a working counter.
  if (kind === 'desktop') { await page.mouse.click(640, 20); await pause(page, 500); }
  const sound = page.getByText(/Ses kapalı/).first();
  if (await sound.isVisible().catch(() => false)) { await sound.click(); await pause(page, 500); }
  // The demo's older calls are answered first, so the clip's own call is the one that appears.
  for (let i = 0; i < 10; i++) {
    const close = page.getByRole('button', { name: /çağrısını kapat$/ }).first();
    if (!(await close.isVisible().catch(() => false))) break;
    await close.click(); await pause(page, 700);
  }
  return { ctx, page };
}

// ---------- The clips ----------
type Clip = { name: string; play: (browser: Browser) => Promise<void> };
const clips: Clip[] = [];
const clip = (name: string, play: Clip['play']) => clips.push({ name, play });

// Post 4: guest scans the QR on the table, the menu opens, orders a Türk kahvesi.
clip('siparis', async browser => {
  const table = await freeTable(browser);
  const staff = await staffScreen(browser, 'garson', 'phone');
  const ctx = await phoneContext(browser), page = await ctx.newPage();
  const qr = await QRCode.toDataURL(guestUrl(table.token), { margin: 1, width: 360, color: { dark: '#163328', light: '#ffffff' } });
  const masa = table.name.replace(/^Masa\s*/, '');
  // The phone's camera on the table's QR stand (a drawing: the café's own stand looks like this, Ayarlar → Masalar ve QR).
  await page.setContent(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
    body{margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(120% 90% at 50% 30%,#8d7a62,#4f4234);font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden}
    .table{position:absolute;inset:auto 0 0 0;height:34%;background:linear-gradient(#6b5440,#4a3828)}
    .stand{position:relative;width:250px;background:#f6f1e8;border-radius:18px;padding:20px 20px 18px;text-align:center;box-shadow:0 30px 60px rgba(20,14,8,.5);transform:perspective(900px) rotateX(8deg) rotate(-2deg)}
    .stand small{display:block;font:700 11px/1.3 'Segoe UI',sans-serif;letter-spacing:2.4px;color:#5a6a61;text-transform:uppercase}
    .stand h1{margin:6px 0 12px;font:400 24px/1.15 Georgia,serif;color:#234c3e}
    .stand img{width:190px;height:190px;display:block;margin:0 auto;border-radius:6px}
    .stand b{display:block;font:800 30px/1 'Segoe UI',sans-serif;color:#163328;margin-top:12px;letter-spacing:1px}
    .stand p{font:13px/1.4 'Segoe UI',sans-serif;color:#33463c;margin:6px 0 0}
    .finder{position:fixed;inset:0;display:grid;place-items:center;pointer-events:none}
    .box{width:236px;height:236px;position:relative;opacity:0;animation:in .4s .6s forwards;transform:translateY(-36px)}
    .box i{position:absolute;width:38px;height:38px;border:4px solid #fff;border-radius:6px}
    .box i:nth-child(1){left:0;top:0;border-right:0;border-bottom:0}.box i:nth-child(2){right:0;top:0;border-left:0;border-bottom:0}
    .box i:nth-child(3){left:0;bottom:0;border-right:0;border-top:0}.box i:nth-child(4){right:0;bottom:0;border-left:0;border-top:0}
    .line{position:absolute;left:8px;right:8px;height:3px;background:#9fd3b8;box-shadow:0 0 14px #9fd3b8;top:10px;animation:scan .9s .8s ease-in-out 2 alternate}
    .pill{position:fixed;bottom:64px;left:50%;transform:translateX(-50%);background:rgba(246,241,232,.95);color:#163328;font:600 15px 'Segoe UI',sans-serif;padding:12px 20px;border-radius:999px;opacity:0;animation:in .3s 2.3s forwards;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.25)}
    .top{position:fixed;top:0;left:0;right:0;height:64px;background:linear-gradient(rgba(0,0,0,.35),transparent)}
    @keyframes in{to{opacity:1}}@keyframes scan{to{top:222px}}
  </style></head><body><div class="table"></div><div class="top"></div><div class="stand"><small>Mola Örnek Kafe</small><h1>Menü ve sipariş</h1><img src="${qr}" alt=""><b>MASA ${masa}</b><p>Okutun, menü açılsın</p></div>
  <div class="finder"><div class="box"><i></i><i></i><i></i><i></i><div class="line"></div></div></div><div class="pill">Mola Örnek Kafe · Menü açılıyor</div></body></html>`);
  await pause(page, 300);
  const rec = new Recorder(page, join(OUT, 'siparis'), PHONE);
  await rec.start();
  await pause(page, 3000);
  rec.mark('menu');
  await page.goto(guestUrl(table.token));
  await page.getByRole('button', { name: /Türk Kahvesi/ }).first().waitFor();
  await imagesOnScreen(page);
  rec.mark('menuReady');
  await pause(page, 1300);
  await smoothScroll(page, 330, 1100); await pause(page, 500);
  rec.mark('product');
  await press(page, page.getByRole('button', { name: /Türk Kahvesi/ }).first(), { hold: 1000 });
  const sugar = page.getByRole('dialog').getByText(/^Orta$/).first();
  if (await sugar.isVisible().catch(() => false)) await press(page, sugar, { hold: 600 });
  rec.mark('add');
  await press(page, page.getByRole('button', { name: /Sepete ekle/ }), { hold: 800 });
  rec.mark('cart');
  await press(page, page.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }), { hold: 1100 });
  rec.mark('send');
  await press(page, page.getByRole('button', { name: 'Siparişi gönder', exact: true }), { hold: 200 });
  await page.getByText(/Siparişiniz alındı|Afiyet olsun/).first().waitFor();
  rec.mark('done');
  await pause(page, 3200);
  await rec.stop();
  await ctx.close(); await staff.ctx.close();
});

// Post 6: guest calls the waiter; the waiter's phone shows it.
clip('garson', async browser => {
  const table = await freeTable(browser);
  const staff = await staffScreen(browser, 'garson', 'phone', true);
  const ctx = await phoneContext(browser), page = await ctx.newPage();
  await openMenu(page, table.token);
  const rec = new Recorder(page, join(OUT, 'garson'), PHONE);
  const recStaff = new Recorder(staff.page, join(OUT, 'garson-personel'), PHONE);
  await rec.start(); await recStaff.start();
  await pause(page, 2400);
  rec.mark('call');
  await press(page, page.getByRole('button', { name: 'Garson çağır' }), { hold: 300 });
  await page.getByRole('button', { name: 'Garson çağrıldı' }).waitFor();
  rec.mark('called');
  await staff.page.locator('.service-call-chip').first().waitFor({ timeout: 15000 });
  rec.mark('staffSees');
  // Where the call is on the waiter's phone (CSS px): the video shows it enlarged.
  writeFileSync(join(OUT, 'garson', 'kutular.json'), JSON.stringify({ chip: await staff.page.locator('.service-call-chip').first().boundingBox() }));
  await pause(page, 4500);
  rec.mark('answer');
  const close = staff.page.getByRole('button', { name: new RegExp(`${table.name} çağrısını kapat`) });
  if (await close.isVisible().catch(() => false)) {
    const box = await close.boundingBox();
    if (box) { await staff.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 }); await pause(staff.page, 350); }
    rec.mark('tap');
    await close.click();
  }
  await page.getByRole('button', { name: 'Garson çağır' }).waitFor({ timeout: 15000 }).catch(() => {});
  rec.mark('reset');
  await pause(page, 2600);
  await recStaff.stop(); await rec.stop();
  writeFileSync(join(OUT, 'garson', 'masa.txt'), table.name);
  await ctx.close(); await staff.ctx.close();
});

// Post 8: guest asks for the bill (pays by card); the counter screen shows it.
clip('hesap', async browser => {
  const table = await freeTable(browser);
  const waiter = await staffScreen(browser, 'garson', 'phone');
  const ctx = await phoneContext(browser), page = await ctx.newPage();
  // Before the recording: the guest's order from the same phone (Siparişlerim shows it), past its change window.
  await openMenu(page, table.token);
  for (const name of [/Caffè Latte/, /San Sebastian/]) {
    await page.getByRole('button', { name }).first().click();
    await page.getByRole('button', { name: /Sepete ekle/ }).click();
    await pause(page, 400);
  }
  await page.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await page.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await page.getByText(/Siparişiniz alındı|Afiyet olsun/).first().waitFor();
  await page.getByRole('button', { name: 'Tamam' }).click().catch(() => {});
  await page.getByRole('button', { name: 'Hesabı iste' }).waitFor({ timeout: 90000 });
  await waiter.ctx.close();
  const kasa = await staffScreen(browser, 'kasiyer', 'desktop');
  const opening = kasa.page.getByRole('form', { name: 'Kasa açılışı' });
  if (await opening.isVisible().catch(() => false)) { await opening.getByLabel('Açılış tutarı').fill('500'); await opening.getByRole('button', { name: 'Açılışı kaydet' }).click(); await pause(kasa.page, 800); }
  // The "Kasa açıldı" note goes before the recording.
  await pause(kasa.page, 5000);
  await openMenu(page, table.token);
  await page.evaluate('scrollTo(0, 0)');
  const rec = new Recorder(page, join(OUT, 'hesap'), PHONE);
  const recKasa = new Recorder(kasa.page, join(OUT, 'hesap-kasa'), DESKTOP);
  await rec.start(); await recKasa.start();
  await pause(page, 2200);
  rec.mark('ask');
  await press(page, page.getByRole('button', { name: 'Hesabı iste' }), { hold: 1100 });
  rec.mark('choose');
  await press(page, page.getByRole('group', { name: 'Nasıl ödeyeceksiniz?' }).getByRole('button', { name: 'Kart' }), { hold: 300 });
  await page.getByRole('button', { name: 'Hesap istendi' }).waitFor();
  rec.mark('asked');
  await kasa.page.locator('.service-call-chip').first().waitFor({ timeout: 15000 });
  rec.mark('kasaSees');
  // Where the call and the table's tile are on the counter screen (CSS px): the video's camera moves to them.
  const chipBox = await kasa.page.locator('.service-call-chip').first().boundingBox();
  const tileBox = await kasa.page.locator('.table-card', { hasText: table.name }).first().boundingBox().catch(() => null);
  writeFileSync(join(OUT, 'hesap', 'kasa-kutular.json'), JSON.stringify({ chip: chipBox, tile: tileBox }));
  await pause(page, 7200);
  await recKasa.stop(); await rec.stop();
  writeFileSync(join(OUT, 'hesap', 'masa.txt'), table.name);
  await ctx.close(); await kasa.ctx.close();
});

// Post 7: the guest menu on a phone (still, 3×).
clip('ekran', async browser => {
  const table = await freeTable(browser);
  const staff = await staffScreen(browser, 'garson', 'phone');
  const ctx = await phoneContext(browser), page = await ctx.newPage();
  await page.addInitScript('window.__molaNoFinger = true');
  await openMenu(page, table.token);
  mkdirSync(join(OUT, 'ekran'), { recursive: true });
  await page.screenshot({ path: join(OUT, 'ekran', 'menu-ust.png') });
  await smoothScroll(page, 330, 10); await pause(page, 800);
  await imagesOnScreen(page);
  await page.screenshot({ path: join(OUT, 'ekran', 'menu-urunler.png') });
  await smoothScroll(page, 700, 10); await pause(page, 800);
  await page.screenshot({ path: join(OUT, 'ekran', 'menu-asagi.png') });
  await ctx.close(); await staff.ctx.close();
});

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', args: [`--force-device-scale-factor=${PHONE.scale}`] });
  deskBrowser = await chromium.launch({ channel: 'chrome', args: [`--force-device-scale-factor=${DESKTOP.scale}`] });
  try {
    // SOSYAL_BAGLAN=1: use servers already started by an earlier `--sunucu` run (same ports), prepared already.
    if (!process.env.SOSYAL_BAGLAN) { await startServers(); await prepareMenu(browser); }
    if (serverOnly) { console.log(`Hazır: ${KAFE} (kafe), ${MERKEZ} (Merkez). Klasör: ${run}`); await new Promise(() => {}); }
    const chosen = only.length ? clips.filter(c => only.includes(c.name)) : clips;
    for (const c of chosen) { console.log(`Kayıt: ${c.name}`); await c.play(browser); }
  } finally {
    await browser.close(); await deskBrowser.close();
    stopAll();
  }
}
await main();
