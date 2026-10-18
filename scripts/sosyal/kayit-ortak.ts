/*
 * Shared parts of the social-video recorders (scripts/sosyal/blok1-kayit.ts, scripts/sosyal/youtube-qr-kayit.ts).
 * Never real data: every run makes a fresh Mola Merkez and a fresh demo café ("Mola Örnek Kafe", scripts/demo-template.ts)
 * in its own run folder, gives its menu the template photos (templates/gorseller) the way an owner uploads a photo, and records
 * the real screens (served dist/: needs `npm run build`).
 *
 * Recording: Chrome's own screencast (CDP Page.startScreencast). Chrome sends frames at the window's own scale, not the emulated
 * one: each kind of screen gets a Chrome whose scale is forced (--force-device-scale-factor), so the frames are 3× (phone) and
 * 2× (desktop). JPEG frames with their timestamps plus named marks in <klip>/meta.json.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

export const ROOT = resolve('.');
export const PASSWORD = 'MolaDemo!2026';
const ADMIN_PASSWORD = 'Sosyal-Blok-Yesil-Fincan!26';

export type Product = { id: string; code: string; name: string; nameEn: string; category: string; subtype?: string; description: string; ingredients?: string; price: number; soldOut: boolean; art: string; photo?: string | null; groups: unknown[]; published?: boolean; unit?: string; readyMade?: boolean; vatRate?: number };
export type Table = { id: string; name: string; token: string; account: unknown; needsCleaning?: boolean };
export type StaffState = { revision: number; products: Product[]; tables: Table[]; commissionBps?: number | null; changeSeconds?: number; waiterApproval?: boolean; paymentMode?: string; sector?: string; cleaningEnabled?: boolean;
  orders: { id: string; status: string; tableId?: string; version: number; cancelRequested?: boolean; source?: string }[]; serviceCalls: { id: string; tableId: string; kind: string }[]; approvalVersion?: number; autoApproveQr?: boolean };

/** Template photo (templates/gorseller/<ad>.webp) for each product of the demo café; the others are taken off the guest menu. */
export const PHOTOS: Record<string, string> = {
  'Caffè Latte': 'latte', 'Americano': 'americano', 'Türk Kahvesi': 'turkish', 'Demleme Çay': 'tea', 'Ihlamur': 'herbal',
  'Ev Yapımı Limonata': 'lemonade', 'Ayran': 'r-ayran', 'San Sebastian': 'cheesecake', 'Çikolatalı Brownie': 'brownie',
  'Fırın Sütlaç': 'd-sutlac', 'Künefe': 'r-kunefe', 'Fıstıklı Baklava': 'd-fistikli', 'Profiterol': 'd-profiterol', 'Kazandibi': 'd-kazandibi',
};
const EXTRA = [
  { code: '61', name: 'Fıstıklı Baklava', nameEn: 'Pistachio Baklava', category: 'Tatlılar', subtype: 'Şerbetli tatlılar', price: 24000, art: 'cake', description: 'İnce yufka, bol Antep fıstığı; porsiyonu dört dilim.', ingredients: 'Yufka, Antep fıstığı, tereyağı, şerbet' },
  { code: '62', name: 'Profiterol', nameEn: 'Profiteroles', category: 'Tatlılar', subtype: 'Sütlü tatlılar', price: 15000, art: 'cake', description: 'Kremalı top hamurlar, üzerinde sıcak çikolata sosu.', ingredients: 'Hamur, krema, bitter çikolata' },
  { code: '63', name: 'Kazandibi', nameEn: 'Kazandibi', category: 'Tatlılar', subtype: 'Sütlü tatlılar', price: 12500, art: 'cake', description: 'Altı karamelize, tarçınla servis edilir.', ingredients: 'Süt, pirinç unu, şeker, tarçın' },
];
export const fields = (p: Product) => ({ ...(p.unit ? { unit: p.unit } : {}), ...(p.readyMade !== undefined ? { readyMade: p.readyMade } : {}), ...(p.vatRate !== undefined ? { vatRate: p.vatRate } : {}), code: p.code, name: p.name, nameEn: p.nameEn, category: p.category, subtype: p.subtype, description: p.description, ingredients: p.ingredients, price: p.price, soldOut: p.soldOut, art: p.art, photo: p.photo ?? null, groups: p.groups });

/** A fingertip that glides to what is tapped and a ring where it presses: viewers see what was touched. */
export const POINTER = `(() => {
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
export const PHONE = { width: 390, height: 844, scale: 3 };
export const DESKTOP = { width: 1280, height: 800, scale: 2 };

export type Frame = { file: string; t: number };
export class Recorder {
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
  /** Saves a box (CSS px of this screen) for the edit's zoom callouts. */
  boxes: Record<string, { x: number; y: number; width: number; height: number } | null> = {};
  async box(name: string, target: Locator) { this.boxes[name] = await target.boundingBox().catch(() => null); }
  async stop() {
    this.mark('end');
    await this.session?.send('Page.stopScreencast').catch(() => {});
    this.stopped = true;
    writeFileSync(join(this.dir, 'meta.json'), JSON.stringify({ size: this.size, frames: this.frames, marks: this.marks, boxes: this.boxes }, null, 1));
    console.log(`  ${this.dir}: ${this.frames.length} kare, ${(this.marks.end - this.marks.start).toFixed(1)} sn`);
  }
}

export const pause = (page: Page, ms: number) => page.waitForTimeout(ms);
/** Glides the finger to the target, then taps it. */
export async function press(page: Page, target: Locator, o: { hold?: number; steps?: number } = {}) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: o.steps ?? 16 }); await pause(page, 260); }
  await target.click();
  await pause(page, o.hold ?? 450);
}
export async function smoothScroll(page: Page, by: number, ms = 900) {
  await page.evaluate(`new Promise(function (done) { var start = scrollY, t0 = performance.now(); function step(t) { var k = Math.min(1, (t - t0) / ${ms}), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; scrollTo(0, start + ${by} * e); if (k < 1) requestAnimationFrame(step); else done(); } requestAnimationFrame(step); })`);
}
/** Waits for the photos on screen (the others load lazily, only when scrolled to). */
export async function imagesOnScreen(page: Page) {
  // The product photos appear in the DOM a moment after the menu: at least two of them loaded first.
  await page.waitForFunction(`[...document.images].filter(function (i) { var r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 80 && i.complete && i.naturalWidth > 0; }).length >= 2`, undefined, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(`[...document.images].filter(function (i) { var r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }).every(function (i) { return i.complete && i.naturalWidth > 0; })`, undefined, { timeout: 15000 }).catch(() => {});
}

export type KitOptions = { run: string; reuse?: boolean; kafePort: number; merkezPort: number };
/** Servers, the demo café and the screens of one run. */
export function kit(o: KitOptions) {
  const KAFE = `http://127.0.0.1:${o.kafePort}`, MERKEZ = `http://127.0.0.1:${o.merkezPort}`;
  mkdirSync(o.run, { recursive: true });
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
    const merkezDir = join(o.run, 'merkez'), kafeDir = join(o.run, 'kafe');
    const merkez = spawn(process.execPath, ['--import', 'tsx', 'server/merkez/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...quiet, MERKEZ_PORT: String(o.merkezPort), MERKEZ_DATA_DIR: merkezDir, SERVE_BUILD: '1', MERKEZ_INITIAL_PASSWORD: ADMIN_PASSWORD } });
    children.push(merkez);
    await waitFor(`${MERKEZ}/api/merkez/v1/health`, 'Mola Merkez');
    if (!o.reuse) {
      console.log('Örnek işletme hazırlanıyor…');
      const demo = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/demo-template.ts', kafeDir, '--gun=5'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...quiet,
        MOLA_MERKEZ_URL: MERKEZ, MERKEZ_DATA_DIR: merkezDir, MERKEZ_ADMIN_PASSWORD: ADMIN_PASSWORD } });
      if (!/Örnek işletme hazır:/.test(demo.stdout ?? '')) { process.stdout.write(demo.stdout ?? ''); throw new Error('Örnek işletme hazırlanamadı.'); }
    }
    const kafe = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...quiet, PORT: String(o.kafePort), SERVE_BUILD: '1', DATA_DIR: kafeDir,
      MOLA_CLEAN_INSTALL: '1', MOLA_MERKEZ_URL: MERKEZ, MOLA_MERKEZ_PUBLIC_KEY: join(merkezDir, 'merkez-public-key.txt'), MOLA_SYNC_SOON_MS: '1000', MOLA_HEARTBEAT_MS: '2000' } });
    children.push(kafe);
    await waitFor(`${KAFE}/api/health`, 'Kafe sunucusu');
  }

  async function post(req: APIRequestContext, path: string, data: unknown) {
    const r = await req.post(`${KAFE}${path}`, { data });
    if (!r.ok()) throw new Error(`${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  }
  const state = async (req: APIRequestContext) => (await (await req.get(`${KAFE}/api/staff/state`)).json()) as StaffState;
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
  /** The owner's API (a signed-in request context) for settings between the clips. */
  async function ownerApi(browser: Browser) {
    const ctx = await browser.newContext(), page = await ctx.newPage();
    await login(page, 'isletme');
    return { ctx, page, req: page.request, close: () => ctx.close() };
  }
  /** Saves the business preferences the way Ayarlar → Sipariş ve onay does (the other values stay as they are). */
  async function settings(req: APIRequestContext, patch: { waiterApproval?: boolean; changeSeconds?: number }) {
    const s = await state(req);
    await post(req, '/api/staff/settings', { sector: s.sector ?? 'cafe', paymentMode: s.paymentMode ?? 'after_service', cleaningEnabled: s.cleaningEnabled ?? false,
      waiterApproval: patch.waiterApproval ?? s.waiterApproval ?? false, changeSeconds: patch.changeSeconds ?? s.changeSeconds ?? 0, commissionBps: s.commissionBps ?? null });
  }

  async function prepareMenu(browser: Browser, prefs: { waiterApproval?: boolean; changeSeconds?: number } = { waiterApproval: false }) {
    const api = await ownerApi(browser), req = api.req;
    let s = await state(req);
    await settings(req, { waiterApproval: prefs.waiterApproval ?? false, changeSeconds: prefs.changeSeconds ?? s.changeSeconds ?? 60 });
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
    await api.close();
  }

  // Each kind of screen has its own Chrome (the scale is forced per browser).
  let phoneBrowser: Browser, deskBrowser: Browser;
  async function launch() {
    phoneBrowser = await chromium.launch({ channel: 'chrome', args: [`--force-device-scale-factor=${PHONE.scale}`] });
    deskBrowser = await chromium.launch({ channel: 'chrome', args: [`--force-device-scale-factor=${DESKTOP.scale}`] });
    return phoneBrowser;
  }
  async function close() { await phoneBrowser?.close().catch(() => {}); await deskBrowser?.close().catch(() => {}); stopAll(); }
  async function phoneContext(_browser?: Browser) {
    const ctx = await phoneBrowser.newContext({ viewport: { width: PHONE.width, height: PHONE.height }, deviceScaleFactor: PHONE.scale, isMobile: false, hasTouch: true, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', colorScheme: 'light', reducedMotion: 'no-preference' });
    await ctx.addInitScript(POINTER);
    return ctx;
  }
  async function desktopContext(_browser?: Browser, finger = false) {
    const ctx = await deskBrowser.newContext({ viewport: { width: DESKTOP.width, height: DESKTOP.height }, deviceScaleFactor: DESKTOP.scale, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', colorScheme: 'light' });
    if (finger) await ctx.addInitScript(POINTER);
    return ctx;
  }
  /** A clean table nobody sits at; `used` keeps each clip on its own table. */
  const used = new Set<string>();
  async function freeTable(browser: Browser, prefer?: string) {
    const ctx = await browser.newContext(), p = await ctx.newPage();
    await login(p, 'isletme');
    const s = await state(p.request);
    await ctx.close();
    const ok = (t: Table) => !t.account && !t.needsCleaning && !used.has(t.id);
    const t = (prefer ? s.tables.find(t => t.name === prefer && ok(t)) : undefined) ?? s.tables.find(t => ok(t) && /^Masa \d+$/.test(t.name)) ?? s.tables.find(t => !t.account && !used.has(t.id))!;
    used.add(t.id);
    return t;
  }
  const guestUrl = (token: string) => `${KAFE}/m/${token}`;
  async function openMenu(page: Page, token: string) {
    await page.goto(guestUrl(token));
    await page.getByRole('button', { name: /Türk Kahvesi/ }).first().waitFor();
    await imagesOnScreen(page);
    await pause(page, 600);
  }
  /** A staff screen that sees the guests (the café's rule: QR orders and calls need one connected). */
  async function staffScreen(user: string, kind: 'phone' | 'desktop', finger = false) {
    const ctx = kind === 'phone' ? await phoneContext() : await desktopContext(undefined, finger);
    const page = await ctx.newPage();
    // No finger on the staff screen unless asked; Mola Yardım's one-time hint stays closed (as in playwright.config.ts).
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
  return { KAFE, MERKEZ, run: o.run, startServers, stopAll, post, state, login, ownerApi, settings, prepareMenu, launch, close, phoneContext, desktopContext, freeTable, guestUrl, openMenu, staffScreen,
    get phoneBrowser() { return phoneBrowser; }, get deskBrowser() { return deskBrowser; } };
}
export type Kit = ReturnType<typeof kit>;

/** The phone's camera on the table's QR stand (a drawing: the café's own stand looks like this, Ayarlar → Masalar ve QR). */
export function qrCameraHtml(qrDataUrl: string, tableName: string, pill = 'Mola Örnek Kafe · Menü açılıyor') {
  const masa = tableName.replace(/^Masa\s*/, '');
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
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
  </style></head><body><div class="table"></div><div class="top"></div><div class="stand"><small>Mola Örnek Kafe</small><h1>Menü ve sipariş</h1><img src="${qrDataUrl}" alt=""><b>MASA ${masa}</b><p>Okutun, menü açılsın</p></div>
  <div class="finder"><div class="box"><i></i><i></i><i></i><i></i><div class="line"></div></div></div><div class="pill">${pill}</div></body></html>`;
}
