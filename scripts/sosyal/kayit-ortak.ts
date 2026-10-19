/*
 * Shared parts of the social-video recorders (scripts/sosyal/blok1-kayit.ts, youtube-qr-kayit.ts, youtube-kurulum-kayit.ts,
 * youtube-garson-kayit.ts, youtube-kasiyer-kayit.ts, youtube-mutfak-kayit.ts, youtube-mudur-kayit.ts, youtube-sahip-kayit.ts,
 * youtube-tanitim-kayit.ts, youtube-stok-kayit.ts, youtube-rapor-kayit.ts).
 * Never real data: every run makes a fresh Mola Merkez and a fresh demo café ("Mola Örnek Kafe", scripts/demo-template.ts)
 * in its own run folder, gives its menu the template photos (templates/gorseller) the way an owner uploads a photo, and records
 * the real screens (served dist/: needs `npm run build`).
 *
 * Recording: Chrome's own screencast (CDP Page.startScreencast). Chrome sends frames at the window's own scale, not the emulated
 * one: each kind of screen gets a Chrome whose scale is forced (--force-device-scale-factor), so the frames are 3× (phone) and
 * 2× (desktop). JPEG frames with their timestamps plus named marks in <klip>/meta.json.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import QRCode from 'qrcode';
import { totp } from '../../server/totp';
import { decodeParts, fakeSmtp } from '../../tests/fake-smtp';

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
/** A landscape tablet (10–11 inch) for the waiter's screen. */
export const TABLET = { width: 1180, height: 820, scale: 2 };
/** A tap the edit shows: the box (CSS px of this screen), when the highlight starts (`on`) and when the tap happens. */
export type Tap = { name: string; box: { x: number; y: number; width: number; height: number }; on: number; tap?: number; off?: number };

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
  taps: Tap[] = [];
  /**
   * A tap the viewer can follow without a pointer: the control is brought into view, its box saved and the screen held still
   * for `lead` ms (the edit zooms in and draws the highlight meanwhile), then it is clicked.
   */
  async tap(page: Page, name: string, target: Locator, o: { lead?: number; hold?: number } = {}) {
    await target.scrollIntoViewIfNeeded(); await pause(page, 350);
    const box = await target.boundingBox();
    const t: Tap = { name, box: box ?? { x: 0, y: 0, width: 0, height: 0 }, on: Date.now() / 1000 };
    await pause(page, o.lead ?? 1500);
    t.tap = Date.now() / 1000; this.taps.push(t);
    await target.click();
    await pause(page, o.hold ?? 900);
  }
  /** Highlights a part of the screen without tapping it (for `ms`). */
  async look(page: Page, name: string, target: Locator, ms = 2500) {
    const box = await target.boundingBox();
    const t: Tap = { name, box: box ?? { x: 0, y: 0, width: 0, height: 0 }, on: Date.now() / 1000 };
    await pause(page, ms);
    t.off = Date.now() / 1000; this.taps.push(t);
  }
  async stop() {
    this.mark('end');
    await this.session?.send('Page.stopScreencast').catch(() => {});
    this.stopped = true;
    writeFileSync(join(this.dir, 'meta.json'), JSON.stringify({ size: this.size, frames: this.frames, marks: this.marks, boxes: this.boxes, taps: this.taps }, null, 1));
    console.log(`  ${this.dir}: ${this.frames.length} kare, ${(this.marks.end - this.marks.start).toFixed(1)} sn`);
  }
}

export const pause = (page: Page, ms: number) => page.waitForTimeout(ms);
/** Types like a person after a tap on the field (the edit keeps it at this speed). */
export async function typeIn(page: Page, rec: Recorder, name: string, field: Locator, text: string, o: { lead?: number; delay?: number } = {}) {
  await rec.tap(page, name, field, { lead: o.lead ?? 700, hold: 150 });
  await field.pressSequentially(text, { delay: o.delay ?? 55 });
  await pause(page, 250);
}
/** A native select: the tap on the field is recorded, then the choice (its list is not in the picture). */
export async function choose(page: Page, rec: Recorder, name: string, select: Locator, label: string) {
  await select.scrollIntoViewIfNeeded(); await pause(page, 300);
  const box = await select.boundingBox(); const t = Date.now() / 1000; rec.taps.push({ name, box: box!, on: t - .2, tap: t });
  await select.focus(); await pause(page, 500);
  await select.selectOption({ label });
  await pause(page, 1200);
}
/** An init script: no spell-check squiggles under typed names; Mola Yardım's one-time hint stays closed (as in playwright.config.ts). */
export const NO_HINTS = `try { localStorage.setItem('mola-yardim-ipucu', 'off'); localStorage.setItem('mola-campaign-ended', 'off'); } catch (e) {}
  document.addEventListener('focusin', function (e) { if (e.target && e.target.setAttribute) e.target.setAttribute('spellcheck', 'false'); }, true);`;
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

/**
 * `saat`: the run plays at another time of day (ms, the shifted "now" at the start; scripts/sosyal/kayit-saat.mjs in the
 * run's own servers, Playwright's clock in its screens). `setClock` moves it forward later (a gün sonu at night).
 * `gun`: days of history the demo café is made with (scripts/demo-template.ts --gun, 3–90; default 5).
 */
export type KitOptions = { run: string; reuse?: boolean; kafePort: number; merkezPort: number; saat?: number; gun?: number };
/** Servers, the demo café and the screens of one run. */
export function kit(o: KitOptions) {
  const KAFE = `http://127.0.0.1:${o.kafePort}`, MERKEZ = `http://127.0.0.1:${o.merkezPort}`;
  mkdirSync(o.run, { recursive: true });
  const children: ChildProcess[] = [];
  const stopAll = () => { for (const c of children) if (c.exitCode === null && c.pid) { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); else c.kill(); } };
  process.on('exit', stopAll);
  for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { stopAll(); process.exit(1); });
  // The recording clock (only with `saat`): one offset file every process of the run reads.
  const clockFile = join(o.run, 'saat.txt');
  let offset = 0;
  if (o.saat !== undefined) { offset = o.saat - Date.now(); writeFileSync(clockFile, String(offset)); }
  const pre = o.saat !== undefined ? ['--import', pathToFileURL(join(ROOT, 'scripts', 'sosyal', 'kayit-saat.mjs')).href] : [];
  const quiet = { ...process.env, MOLA_AUTO_BACKUP: '0', MOLA_BACKUP_DISCOVERY: '0', ...(o.saat !== undefined ? { MOLA_KAYIT_SAAT: clockFile } : {}) };
  /** The run's "now" (shifted with `saat`). */
  const now = () => Date.now() + offset;
  const clocked = new Set<BrowserContext>();
  /** A screen of the run on the run's clock (time flows as usual from there). */
  async function clockOn(ctx: BrowserContext) {
    if (o.saat === undefined) return ctx;
    await ctx.clock.install({ time: now() }); clocked.add(ctx); ctx.on('close', () => clocked.delete(ctx));
    return ctx;
  }
  /** Moves the run's clock forward to `at` (ms): the servers and every open screen (their due timers fire once). */
  async function setClock(at: number) {
    if (o.saat === undefined) throw new Error('setClock: kit({ saat }) gerekir.');
    const d = Math.round(at - now());
    if (d <= 0) throw new Error('Saat yalnız ileri alınır.');
    offset += d; writeFileSync(clockFile, String(offset));
    await new Promise(r => setTimeout(r, 900));
    for (const c of clocked) await c.clock.fastForward(d);
  }
  async function waitFor(url: string, what: string) {
    for (let i = 0; i < 400; i++) { try { if ((await fetch(url)).ok) return; } catch { /* starting */ } await new Promise(r => setTimeout(r, 150)); }
    throw new Error(`${what} açılmadı.`);
  }
  async function startServers() {
    const merkezDir = join(o.run, 'merkez'), kafeDir = join(o.run, 'kafe');
    const merkez = spawn(process.execPath, [...pre, '--import', 'tsx', 'server/merkez/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...quiet, MERKEZ_PORT: String(o.merkezPort), MERKEZ_DATA_DIR: merkezDir, SERVE_BUILD: '1', MERKEZ_INITIAL_PASSWORD: ADMIN_PASSWORD } });
    children.push(merkez);
    await waitFor(`${MERKEZ}/api/merkez/v1/health`, 'Mola Merkez');
    if (!o.reuse) {
      console.log('Örnek işletme hazırlanıyor…');
      const demo = spawnSync(process.execPath, [...pre, '--import', 'tsx', 'scripts/demo-template.ts', kafeDir, `--gun=${o.gun ?? 5}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], env: { ...quiet,
        MOLA_MERKEZ_URL: MERKEZ, MERKEZ_DATA_DIR: merkezDir, MERKEZ_ADMIN_PASSWORD: ADMIN_PASSWORD } });
      if (!/Örnek işletme hazır:/.test(demo.stdout ?? '')) { process.stdout.write(demo.stdout ?? ''); throw new Error('Örnek işletme hazırlanamadı.'); }
    }
    const kafe = spawn(process.execPath, [...pre, '--import', 'tsx', 'server/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...quiet, PORT: String(o.kafePort), SERVE_BUILD: '1', DATA_DIR: kafeDir,
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
    // A campaign that ended in a longer history opens its one-time window on top of everything: closed first.
    const ended = page.locator('dialog.campaign-ended-dialog');
    if (await ended.isVisible().catch(() => false)) { await page.keyboard.press('Escape'); await pause(page, 600); }
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
    return clockOn(ctx);
  }
  async function tabletContext() {
    return clockOn(await deskBrowser.newContext({ viewport: { width: TABLET.width, height: TABLET.height }, deviceScaleFactor: TABLET.scale, hasTouch: true, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', colorScheme: 'light' }));
  }
  async function desktopContext(_browser?: Browser, finger = false) {
    const ctx = await deskBrowser.newContext({ viewport: { width: DESKTOP.width, height: DESKTOP.height }, deviceScaleFactor: DESKTOP.scale, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', colorScheme: 'light' });
    if (finger) await ctx.addInitScript(POINTER);
    return clockOn(ctx);
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
  async function staffScreen(user: string, kind: 'phone' | 'desktop' | 'tablet', finger = false) {
    const ctx = kind === 'phone' ? await phoneContext() : kind === 'tablet' ? await tabletContext() : await desktopContext(undefined, finger);
    const page = await ctx.newPage();
    // No finger on the staff screen unless asked; Mola Yardım's one-time hint stays closed (as in playwright.config.ts).
    await page.addInitScript(`${finger ? '' : 'window.__molaNoFinger = true;'} try { localStorage.setItem('mola-yardim-ipucu', 'off'); localStorage.setItem('mola-campaign-ended', 'off'); } catch (e) {}`);
    await login(page, user);
    await page.goto(`${KAFE}/`); await pause(page, 1200);
    // A click on the page header unlocks the sounds (the "Ses kapalı" note goes away), as on a working counter.
    if (kind !== 'phone') { await page.mouse.click(640, 20); await pause(page, 500); }
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
  /**
   * The demo's live floor calmed (scripts/sosyal/youtube-qr-kayit.ts, youtube-garson-kayit.ts): pending QR approvals and cancel
   * requests answered, open orders served (`keepOrders`: left as they are, the floor keeps its mixed states), calls answered,
   * "İlk adımlar" dismissed; unless `quiet`, the cash day opened by the cashier too (the counter screen's "Kasa açılışı" card
   * goes away). Then only a clip's own orders and calls appear.
   */
  async function calm(browser: Browser, quiet = false, opt: { keepOrders?: boolean } = {}) {
    const api = await ownerApi(browser), req = api.req;
    const s = await state(req);
    const tryPost = async (path: string, body: unknown) => { try { await post(req, path, body); return true; } catch { return false; } };
    for (const o of s.orders.filter(o => o.status === 'awaiting_approval')) await tryPost('/api/staff/orders/review', { requestId: randomUUID(), orderId: o.id, version: o.version, approve: true });
    for (const o of (await state(req)).orders.filter(o => o.cancelRequested)) await tryPost('/api/staff/cancel', { requestId: randomUUID(), orderId: o.id, version: o.version, stockUsed: false });
    if (!opt.keepOrders) for (const step of ['preparing', 'ready', 'served'] as const)
      for (const o of (await state(req)).orders.filter(o => !['served', 'cancelled', 'rejected'].includes(o.status)))
        await tryPost('/api/staff/status', { requestId: randomUUID(), orderId: o.id, version: o.version, status: step });
    for (const c of (await state(req)).serviceCalls) await tryPost('/api/staff/calls/resolve', { callId: c.id });
    await tryPost('/api/staff/first-steps', { step: 'dismiss' });
    await api.close();
    if (quiet) return;
    const ctx = await browser.newContext(), p = await ctx.newPage();
    await login(p, 'kasiyer');
    await post(p.request, '/api/staff/cash/open', { requestId: randomUUID(), amount: 50000 }).catch(() => {});
    await ctx.close();
    const check = await ownerApi(browser), after = await state(check.req);
    await check.close();
    console.log(`Salon sakin: açık sipariş ${after.orders.filter(o => !['served', 'cancelled', 'rejected'].includes(o.status)).length}, çağrı ${after.serviceCalls.length}`);
  }
  /** Ayarlar values changed through the owner's API between the clips (garson onayı, change window, QR siparişleri açık/kapalı). */
  async function setPrefs(browser: Browser, patch: { waiterApproval?: boolean; changeSeconds?: number; qrOpen?: boolean }) {
    const api = await ownerApi(browser);
    if (patch.waiterApproval !== undefined || patch.changeSeconds !== undefined) await settings(api.req, patch);
    if (patch.qrOpen !== undefined) await post(api.req, '/api/staff/qr-ordering', { requestId: randomUUID(), open: patch.qrOpen });
    await api.close();
  }

  // ---------- Off-camera work of the demo's staff (the training videos' recorders) ----------
  /** A signed-in request context of one of the demo's accounts (isletme, kasiyer, garson, mutfak, or one made by the run). */
  async function as(user: string) {
    const ctx = await deskBrowser.newContext(), page = await ctx.newPage();
    await login(page, user);
    return { req: page.request, close: () => ctx.close() };
  }
  const floorOf = async (req: APIRequestContext) => (await (await req.get(`${KAFE}/api/staff/state`)).json()) as Floor;
  /** The waiter's order, as the tablet sends it (`Want`: a required choice without a named option takes its first). */
  async function order(table: string, wants: Want[]) {
    const w = await as('garson'), s = await floorOf(w.req), t = s.tables.find(x => x.name === table)!;
    const cart = wants.map(x => cartLine(s, x));
    await post(w.req, '/api/staff/orders', { requestId: randomUUID(), tableId: t.id, lines: cart.map(c => c.line), expectedTotal: cart.reduce((n, c) => n + c.total, 0) });
    await w.close();
  }
  /** The kitchen's steps through the owner's API (no kitchen screen on camera). `table`: undefined = every order. */
  async function advance(to: ('preparing' | 'ready' | 'served')[], table?: string) {
    const api = await ownerApi(deskBrowser);
    for (const step of to) {
      const s = await floorOf(api.req);
      for (const o of s.orders.filter(o => (!table || o.tableName === table) && !['served', 'cancelled', 'rejected', 'awaiting_approval'].includes(o.status) && o.status !== step))
        await post(api.req, '/api/staff/status', { requestId: randomUUID(), orderId: o.id, version: o.version, status: step }).catch(() => {});
    }
    await api.close();
  }
  /** The cashier takes a whole bill (off camera). */
  async function pays(table: string, method: 'cash' | 'card') {
    const c = await as('kasiyer'), s = await floorOf(c.req), a = [...s.tables, ...(s.takeaways ?? [])].find(t => t.name === table)!.account!;
    await post(c.req, '/api/staff/payments', { requestId: randomUUID(), paymentContext: s.paymentContext, accountId: a.id, version: a.version, method, amount: a.balance, tendered: method === 'cash' ? Math.ceil(a.balance / 10000) * 10000 : a.balance });
    await c.close();
  }
  /** Every table waiting for cleaning cleaned (as the waiter does). */
  async function cleanAll() {
    const w = await as('garson'), s = await floorOf(w.req);
    for (const t of s.tables.filter(t => t.needsCleaning)) await post(w.req, '/api/staff/tables/clean', { requestId: randomUUID(), tableId: t.id, epoch: t.epoch });
    await w.close();
  }
  /** Every open bill paid (cash and card by turns), every order served, empty bills closed, every table cleaned. */
  async function settleAll() {
    await advance(['preparing', 'ready', 'served']);
    const api = await ownerApi(deskBrowser);
    let s = await floorOf(api.req), n = 0;
    for (const t of [...s.tables, ...(s.takeaways ?? [])]) if (t.account && t.account.balance > 0) await pays(t.name, n++ % 3 === 1 ? 'cash' : 'card');
    s = await floorOf(api.req);
    for (const t of [...s.tables, ...(s.takeaways ?? [])]) if (t.account && !t.account.balance) await post(api.req, '/api/staff/close-empty', { requestId: randomUUID(), accountId: t.account.id }).catch(() => {});
    await api.close();
    await cleanAll();
  }
  /** The cashier opens the kasa with `amount` (kuruş) in the drawer (off camera). */
  async function openKasa(amount = 50000) {
    const c = await as('kasiyer');
    await post(c.req, '/api/staff/cash/open', { requestId: randomUUID(), amount });
    await c.close();
  }
  /**
   * The cashier's gün sonu (off camera): the drawer counted (`count` from the expected cash, default exactly that, never below 0) and `left`
   * kept in it for tomorrow (at most what was counted). Returns the expected cash (null: no kasa was open).
   */
  async function closeKasa(o: { count?: (expected: number) => number; left?: number } = {}) {
    const api = await ownerApi(deskBrowser);
    const expected = (await (await api.req.get(`${KAFE}/api/staff/cash/expected`)).json() as { expected: number | null }).expected;
    await api.close();
    // null: no kasa open (that day's gün sonu is done already), nothing to close.
    if (expected === null) return null;
    const c = await as('kasiyer');
    const amount = o.count ? o.count(expected) : Math.max(0, expected);
    const counted = await post(c.req, '/api/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: amount, pos: null }) as { id: string };
    // Never more left in the drawer than was counted.
    await post(c.req, '/api/staff/cash/finish', { id: counted.id, left: Math.min(o.left ?? 50000, amount) });
    await c.close();
    return expected;
  }
  /**
   * A guest's QR order from the table's phone (never on camera): `wants` are product names, one each (a required choice keeps
   * its ready-selected option). Needs a staff screen connected (the café's rule for QR orders).
   */
  async function guestOrder(table: string, wants: string[]) {
    const api = await ownerApi(deskBrowser), token = (await state(api.req)).tables.find(t => t.name === table)!.token; await api.close();
    const ctx = await phoneContext(), page = await ctx.newPage();
    await openMenu(page, token);
    const add = page.getByRole('button', { name: /Sepete ekle/ });
    for (const name of wants) {
      await page.locator('.product-card', { hasText: name }).first().locator('.add-circle').click(); await pause(page, 700);
      if (await add.isVisible().catch(() => false)) { await add.click(); await pause(page, 500); }
    }
    await page.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click(); await pause(page, 600);
    await page.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
    await page.getByText(/gönderildi|alındı/).first().waitFor({ timeout: 15000 });
    await ctx.close();
  }
  /** A masasız ticket at the counter (Sipariş al → Masasız sipariş, by the cashier, off camera); returns its name ("Masasız #3"). */
  async function takeaway(wants: Want[], label?: string) {
    const c = await as('kasiyer'), s = await floorOf(c.req), cart = wants.map(x => cartLine(s, x));
    const r = await post(c.req, '/api/staff/takeaway/orders', { requestId: randomUUID(), lines: cart.map(x => x.line), expectedTotal: cart.reduce((n, x) => n + x.total, 0), ...(label ? { label } : {}) }) as { tableName: string };
    await c.close();
    return r.tableName;
  }
  /**
   * A day of the floor (off camera, on the recording clock): each visit is ordered at its minute of the day (by the waiter, or
   * by the guest's phone with `qr`, or as a masasız ticket at the counter with `masasiz`, its call name or ''), goes through
   * the kitchen and is paid 35 minutes later. Tables are cleaned at the end. `day`: days from today (istanbul), default today.
   */
  async function serveDay(visits: { table: string; at: number; lines: Want[]; method: 'cash' | 'card'; qr?: boolean; masasiz?: string }[], day = 0) {
    for (const v of visits) {
      await setClock(istanbul(day, Math.floor(v.at / 60), v.at % 60));
      let table = v.table;
      if (v.masasiz !== undefined) table = await takeaway(v.lines, v.masasiz || undefined);
      else if (v.qr) await guestOrder(v.table, v.lines.flatMap(([name, n]) => Array<string>(n).fill(name)));
      else await order(v.table, v.lines);
      await advance(['preparing', 'ready', 'served'], table);
      await setClock(istanbul(day, Math.floor(v.at / 60), v.at % 60 + 35));
      await pays(table, v.method);
    }
    await cleanAll();
  }
  /** The owner's Bildirimler all read (the bell has no count, no toast comes on the next screen). */
  async function readNotifications() {
    const api = await ownerApi(deskBrowser);
    await post(api.req, '/api/staff/notifications/read', {});
    await api.close();
  }
  /** Mola Yönetim's admin API on the run's Merkez, signed in as its admin: `call(path, body)` posts to /api/merkez/admin<path>. */
  async function merkezAdmin() {
    const jar: string[] = [];
    const call = async (path: string, body: unknown) => {
      const r = await fetch(`${MERKEZ}/api/merkez/admin${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: jar.join('; ') }, body: JSON.stringify(body) });
      for (const v of r.headers.getSetCookie()) jar.push(v.split(';')[0]);
      if (!r.ok) throw new Error(`Mola Merkez ${path}: ${r.status} ${await r.text()}`);
    };
    await call('/login', { username: 'admin', password: ADMIN_PASSWORD });
    return call;
  }
  /**
   * İşletmemi yönet made ready off camera, as Ayarlar → Uzaktan erişim does it: step 1, the owner's phone code (TOTP; `code()`
   * gives the next unused code on the run's clock, waiting when needed) and step 2, the e-mail (Mola Merkez sends its code to a
   * fake SMTP server here, then Merkez's e-mail is switched off again); `admin`: step 5 "Uzaktan yönetim" turned on too.
   * Returns once Mola Merkez lets the owner's phone in (the café's heartbeat brought the key). From then on the owner's sign-in
   * asks for the phone code: ownerApi, readNotifications, advance and the owner's staffScreen no longer sign in (call this last).
   */
  async function ownerRemote(o: { email: string; admin?: boolean }) {
    const api = await ownerApi(deskBrowser), req = api.req;
    const { secret } = await post(req, '/api/staff/report-security/setup', { password: PASSWORD }) as { secret: string };
    let used = Math.floor(now() / 30000) - 2;
    const code = async () => {
      for (;;) {
        const current = Math.floor(now() / 30000), step = Math.max(current - 1, used + 1);
        if (step <= current + 1) { used = step; return totp(secret, step * 30000); }
        await new Promise(r => setTimeout(r, 1000));
      }
    };
    await post(req, '/api/staff/report-security/enable', { code: await code() });
    const smtp = await fakeSmtp('kullanilmaz'), call = await merkezAdmin();
    const mail = (on: boolean) => call('/email', { enabled: on, host: on ? '127.0.0.1' : 'smtp.gmail.com', port: on ? smtp.port : 465, security: on ? 'none' : 'tls', user: '', to: 'bildirim@ornekkafe.com', from: on ? 'mola@ornekkafe.com' : '' });
    await mail(true);
    try {
      const { ticket } = await post(req, '/api/staff/owner-email/new-code', { email: o.email, password: PASSWORD }) as { ticket: string };
      const got = () => smtp.received.filter(m => m.to.some(t => t.includes(o.email)));
      for (let i = 0; !got().length && i < 150; i++) await new Promise(r => setTimeout(r, 100));
      const sent = /\b(\d{6})\b/.exec(decodeParts(got().at(-1)?.data ?? '').find(p => !p.name)?.text ?? '')?.[1];
      if (!sent) throw new Error('İşletmemi yönet: e-posta kodu gelmedi.');
      await post(req, '/api/staff/owner-email/confirm', { ticket, code: sent });
    } finally { await mail(false); await smtp.close(); }
    if (o.admin) await post(req, '/api/staff/remote-admin', { on: true, password: PASSWORD, code: await code() }).catch(e => console.warn(`Uzaktan yönetim açılamadı: ${(e as Error).message}`));
    await api.close();
    for (let i = 0; i < 30; i++) {
      const r = await fetch(`${MERKEZ}/api/merkez/v1/phone/login/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: o.email }) });
      if (r.status === 200) break;
      await new Promise(r => setTimeout(r, 2000));
    }
    return { code };
  }
  /**
   * İşletmemi yönet on the owner's phone (after ownerRemote; only through Mola Merkez, as from outside: the café's own address
   * is blocked for this phone): signed in with the e-mail, the password and the phone code; returns once "Bugünün satışı" is
   * on screen (with Uzaktan yönetim on, from the café's screens through their bar's "Raporlar"). No finger on this phone.
   */
  async function ownerPhone(remote: { code: () => Promise<string> }, email: string) {
    const ctx = await phoneContext(); await ctx.addInitScript('window.__molaNoFinger = true');
    await ctx.route(`${KAFE}/**`, r => r.abort());
    const page = await ctx.newPage();
    await page.goto(`${MERKEZ}/yonet`);
    const login = page.getByRole('form', { name: 'Giriş yap' });
    await login.getByLabel('E-posta').fill(email);
    await login.getByLabel('Şifre', { exact: true }).fill(PASSWORD);
    await login.getByRole('button', { name: 'Devam' }).click();
    const codeForm = page.getByRole('form', { name: 'Telefon kodu' });
    await codeForm.getByLabel('Telefon kodu').fill(await remote.code());
    await codeForm.getByRole('button', { name: 'Giriş yap' }).click();
    const hero = page.getByRole('region', { name: 'Bugünün satışı' }), reports = page.getByRole('button', { name: 'Raporlar', exact: true });
    await hero.or(reports).first().waitFor({ timeout: 30000 });
    if (await reports.isVisible().catch(() => false)) { await pause(page, 1500); await reports.click(); }
    await hero.waitFor({ timeout: 30000 });
    return { ctx, page, hero };
  }
  /**
   * Stok set up off camera as the owner does it there (Stok → Malzemeler, Reçeteler): the ingredients with what is on the shelf
   * now, an optional "Uyarı sınırı" and unit price (`price`: TL per kg, L or piece, as the form asks), then the recipes by product
   * and option names (`scale`: Büyük boy 1.5; `add`: [item, amount]; `replace`: [instead of, item]). Amounts in g, ml or pieces.
   * Returns the item ids by name.
   */
  async function setUpStock(items: StockSeed[], recipes: RecipeSeed[] = []) {
    const api = await ownerApi(deskBrowser), req = api.req, ids: Record<string, string> = {};
    for (const i of items) {
      const unitCost = i.price === undefined ? null : i.price * 100 / (i.unit === 'piece' ? 1 : 1000);
      const r = await post(req, '/api/staff/stock/items', { name: i.name, unit: i.unit, min: i.min ?? null, initial: i.initial, ...(unitCost === null ? {} : { unitCost }) }) as { item: { id: string } };
      ids[i.name] = r.item.id;
    }
    const s = await floorOf(req), product = (name: string) => { const p = s.products.find(x => x.name === name); if (!p) throw new Error(`Ürün yok: ${name}`); return p; };
    for (const r of recipes) {
      const p = product(r.product);
      const options = (r.options ?? []).map(o => {
        const g = p.groups.find(x => x.name === o.group)!, opt = g.options.find(x => x.name === o.option)!;
        return { groupId: g.id, optionId: opt.id, ...(o.scale ? { scale: o.scale } : {}), ...(o.add ? { add: o.add.map(([n, amount]) => ({ itemId: ids[n], amount })) } : {}), ...(o.replace ? { replace: o.replace.map(([from, to]) => ({ from: ids[from], to: ids[to] })) } : {}) };
      });
      await post(req, '/api/staff/stock/recipes', { productId: p.id, mode: 'recipe', items: r.items.map(([n, amount]) => ({ itemId: ids[n], amount })), options });
    }
    await api.close();
    return ids;
  }
  /** What Stok expects on the shelf now (base units by item name), as `user` reads it (the owner by default). */
  async function stockLevels(user = 'isletme') {
    const u = await as(user), r = await (await u.req.get(`${KAFE}/api/staff/stock`)).json() as { items: { name: string; stock: number }[] };
    await u.close();
    return Object.fromEntries(r.items.map(i => [i.name, i.stock]));
  }
  /** Mola Yönetim → Ayarlar → "Mola ekibi iletişim bilgileri" on the run's Merkez (the cafés get it with their next heartbeat). */
  async function molaContact(c: { phone?: string; whatsapp?: string; email?: string; hours?: string; web?: string }) {
    const call = await merkezAdmin();
    await call('/contact', { phone: '', whatsapp: '', email: '', hours: '', web: '', ...c });
  }
  return { KAFE, MERKEZ, run: o.run, now, setClock, startServers, stopAll, post, state, login, ownerApi, settings, prepareMenu, calm, setPrefs, launch, close, phoneContext, desktopContext, tabletContext, freeTable, guestUrl, openMenu, staffScreen,
    as, order, advance, pays, cleanAll, settleAll, openKasa, closeKasa, guestOrder, takeaway, serveDay, merkezAdmin, ownerRemote, ownerPhone, molaContact, readNotifications, setUpStock, stockLevels,
    get phoneBrowser() { return phoneBrowser; }, get deskBrowser() { return deskBrowser; } };
}
/**
 * The demo café's Stok as an owner sets it up (Kit.setUpStock; prices in TL per kg, L or piece): video 02 adds Yulaf sütü and
 * writes Caffè Latte and San Sebastian on camera.
 */
export const DEMO_STOCK: StockSeed[] = [
  { name: 'Espresso çekirdeği', unit: 'g', initial: 2400, min: 500, price: 900 }, { name: 'Süt', unit: 'ml', initial: 9000, min: 4000, price: 36 },
  { name: 'Türk kahvesi', unit: 'g', initial: 1200, min: 250, price: 800 }, { name: 'Siyah çay', unit: 'g', initial: 1500, min: 300, price: 300 },
  { name: 'Ihlamur', unit: 'g', initial: 400, min: 100, price: 2000 }, { name: 'Limon', unit: 'piece', initial: 40, min: 10, price: 8 },
  { name: 'Şeker', unit: 'g', initial: 5000, min: 1000, price: 40 }, { name: 'Krem peynir', unit: 'g', initial: 3200, min: 1000, price: 400 },
  { name: 'Yumurta', unit: 'piece', initial: 60, min: 15, price: 5 }, { name: 'Krema', unit: 'ml', initial: 2000, min: 500, price: 200 },
  { name: 'Tel kadayıf', unit: 'g', initial: 2000, min: 500, price: 160 }, { name: 'Künefe peyniri', unit: 'g', initial: 1800, min: 500, price: 450 },
];
/** The recipes written before Kârlılık is looked at (video 02 writes Caffè Latte and San Sebastian on camera). */
export const DEMO_RECIPES: RecipeSeed[] = [
  { product: 'Americano', items: [['Espresso çekirdeği', 18]], options: [{ group: 'Boy', option: 'Büyük', scale: 1.5 }] },
  { product: 'Türk Kahvesi', items: [['Türk kahvesi', 7]] },
  { product: 'Demleme Çay', items: [['Siyah çay', 6]] },
  { product: 'Ihlamur', items: [['Ihlamur', 5], ['Limon', 1]] },
  { product: 'Ev Yapımı Limonata', items: [['Limon', 3], ['Şeker', 40]] },
  { product: 'Künefe', items: [['Tel kadayıf', 60], ['Künefe peyniri', 80]] },
];
/** [product, quantity, option names, note] of a waiter's order line. */
export type Want = [string, number, string[]?, string?];
/** An ingredient of Kit.setUpStock: `initial` and `min` in g, ml or pieces; `price` in TL per kg, L or piece. */
export type StockSeed = { name: string; unit: 'g' | 'ml' | 'piece'; initial: number; min?: number; price?: number };
/** A recipe of Kit.setUpStock: [item, amount] for one piece; options by group and option name. */
export type RecipeSeed = { product: string; items: [string, number][]; options?: { group: string; option: string; scale?: number; add?: [string, number][]; replace?: [string, string][] }[] };
type FloorAccount = { id: string; version: number; balance: number; total: number; paid: number };
type FloorTable = { id: string; name: string; epoch: number; token: string; needsCleaning?: boolean; account: FloorAccount | null };
/** One line of a waiter's order and its total (a required choice without a named option takes its first). */
export function cartLine(s: { products: FloorProduct[] }, [name, quantity, opts = [], note]: Want) {
  const p = s.products.find(x => x.name === name);
  if (!p) throw new Error(`Ürün yok: ${name}`);
  const picked = p.groups.flatMap(g => { const o = g.options.find(o => opts.includes(o.name)) ?? (g.required ? g.options[0] : undefined); return o ? [{ g, o }] : []; });
  const unit = p.price + picked.reduce((n, x) => n + x.o.extra, 0);
  return { line: { productId: p.id, quantity, selections: picked.map(x => ({ groupId: x.g.id, optionId: x.o.id })), ...(note ? { note } : {}) }, total: unit * quantity };
}
type FloorProduct = { id: string; name: string; price: number; groups: { id: string; name: string; required: boolean; options: { id: string; name: string; extra: number }[] }[] };
/** The staff snapshot as these helpers read it. */
type Floor = { paymentContext: string; tables: FloorTable[]; takeaways?: FloorTable[];
  products: FloorProduct[];
  orders: { id: string; status: string; version: number; tableName?: string }[] };
/** A time of the Istanbul day `day` days from today's (real) date, as ms (for kit({ saat }) and setClock). */
export function istanbul(day: number, hh: number, mm: number) {
  const d = new Date(Date.now() + 3 * 3600e3), start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + day * 86400e3;
  return start + (hh - 3) * 3600e3 + mm * 60e3;
}
export type Kit = ReturnType<typeof kit>;

/** The built site (site/dist) as molayazilim.com.tr serves it (/indir/ → indir/index.html; downloads are never sent), on 127.0.0.1:`port`. */
export function siteServer(port: number) {
  const root = join(ROOT, 'site', 'dist');
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
  const s = createServer((req, res) => {
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^([/\\])+/, '');
    let file = join(root, path);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    if (/\.(zip|gz|apk)$/.test(file)) { res.writeHead(204).end(); return; }  // the downloads are never sent
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  return new Promise<Server>(r => s.listen(port, '127.0.0.1', () => r(s)));
}
/** The phone's camera on the table's QR stand, its code reading `url` (qrCameraHtml below). */
export async function qrStand(page: Page, url: string, tableName: string) {
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#163328', light: '#ffffff' } });
  await page.setContent(qrCameraHtml(qr, tableName));
  await pause(page, 300);
}
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
