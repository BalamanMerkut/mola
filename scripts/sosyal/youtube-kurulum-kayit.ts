/*
 * YouTube 06 "Kurulum": recordings of the REAL screens for the installation guide (edit: scripts/sosyal/youtube-kurulum-kurgu.ts).
 * One continuous run on a FRESH install, in story order (each clip needs the state the one before left):
 *   k1-site        the built site (site/dist, served here): ana sayfa → "Uygulamayı indir" → Windows "İndir" (no real download).
 *   k2-etkin       the Mola window (desktop key, as Mola.exe opens it): "Mola'yı etkinleştir" → "Kodum yok, başvuru yapacağım" →
 *                  Hesap açma başvurusu (demo values) → "Başvurunuz alındı · Onay bekleniyor"; Mola Merkez approves it behind
 *                  the scenes (its admin API) → "İşletme sahibi hesabı" → "Hesabı oluştur" → Kurtarma kodunuz (Kaydettim, two
 *                  groups) → the setup wizard (İşletme türü Kafe, masalar, kaydet) → Masalar with "İlk adımlar".
 *   k3-menu        İlk adımlar → Menüye git → Menü yönetimi (template photos) → a product → price → Kaydet.
 *   k4-personel    İlk adımlar → Hesap aç → Personel → Çalışan ekle (garson).
 *   k5-cihaz       the rail's "Kafe içi cihazlar" (QR of /uygulama).  + k5-tablet: the tablet's /uygulama page, sign-in, Masalar.
 *   k6-yazici      Ayarlar → Cihazlar → Yazıcılar → Yazıcı ekle (Mutfak, Ağ, IP) → Kaydet. (The printer is switched off
 *                  ("Yazıcı açık") off camera: there is none at 192.168.1.50 and its failed tickets would show on the next screens.)
 *   k7-garson / k7-mutfak / k7-kasa   the first order: tablet → kitchen screen (its account made off camera, role Mutfak) →
 *                  in the Mola window the day's cash opening (Kasa açılışı) and the payment.
 *   k8-paket       Ayarlar → İşletme → Paket ve lisans: "Deneme · n gün kaldı".
 *
 *   npx tsx scripts/sosyal/youtube-kurulum-kayit.ts            (needs `npm run build`; ~6 minutes)
 *
 * Fresh Mola Merkez + fresh café server (scripts/test-protected-server.ts: the desktop key and key protection as installed,
 * with the test OS lock) on free ports in .local/sosyal/youtube/kurulum/run-<zaman>/; every process is stopped at the end.
 * No pointer: taps go through Recorder.tap (box saved, a still lead-in the edit cuts). The Mola window is 1280×720 (2×),
 * the waiter's tablet 1180×820 (2×). The café computer's network address shown in "Kafe içi cihazlar" is a sample LAN address
 * (the recording server listens on 127.0.0.1 only; a real install shows its own 192.168.… address there).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { Server } from 'node:http';
import { createServer as netServer } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, request as pwRequest, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { validVkn } from '../../packages/domain/invoice';
import { NO_HINTS, ROOT, Recorder, TABLET, imagesOnScreen, pause, siteServer, smoothScroll, typeIn } from './kayit-ortak';

const BASE = join(ROOT, '.local', 'sosyal', 'youtube', 'kurulum');
const OUT = join(BASE, 'kayit');
const RUN = join(BASE, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const ADMIN_PASSWORD = 'Kurulum-Yesil-Fincan!26';
const DESK = { width: 1280, height: 720, scale: 2 };
mkdirSync(OUT, { recursive: true }); mkdirSync(RUN, { recursive: true });

// ---------- Demo values (made up; no real business or person) ----------
const BUSINESS = 'Örnek Kafe Elazığ';
const OWNER = { username: 'ornekkafe', name: 'Ayşe Demir', password: 'OrnekKafe!2026' };
const WAITER = { name: 'Elif Kaya', password: 'Garson!2026x' };
const KITCHEN = { username: 'mutfak', name: 'Mutfak', password: 'Mutfak!2026x' };
/** A 10-digit tax number with a valid check digit (packages/domain/invoice.ts), not a known one. */
function taxNumber(prefix = '734105268') {
  for (let d = 0; d < 10; d++) if (validVkn(prefix + d)) return prefix + d;
  throw new Error('Vergi numarası üretilemedi.');
}

// ---------- Processes ----------
const children: ChildProcess[] = [];
const servers: Server[] = [];
function stopAll() {
  for (const c of children) if (c.exitCode === null && c.pid) { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); else c.kill(); }
  for (const s of servers) s.close();
}
process.on('exit', stopAll);
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { stopAll(); process.exit(1); });
const freePort = () => new Promise<number>((done, fail) => { const s = netServer(); s.once('error', fail); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => done(p)); }); });
async function waitFor(url: string, what: string) {
  for (let i = 0; i < 400; i++) { try { if ((await fetch(url)).ok) return; } catch { /* starting */ } await new Promise(r => setTimeout(r, 150)); }
  throw new Error(`${what} açılmadı.`);
}
const quiet = { ...process.env, MOLA_AUTO_BACKUP: '0', MOLA_BACKUP_DISCOVERY: '0' };
let KAFE = '', MERKEZ = '', SITE = '', TOKEN = '';
async function startServers() {
  const [mp, kp, sp] = [await freePort(), await freePort(), await freePort()];
  MERKEZ = `http://127.0.0.1:${mp}`; KAFE = `http://127.0.0.1:${kp}`; SITE = `http://127.0.0.1:${sp}`;
  const merkezDir = join(RUN, 'merkez'), kafeDir = join(RUN, 'kafe');
  children.push(spawn(process.execPath, ['--import', 'tsx', 'server/merkez/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...quiet, MERKEZ_PORT: String(mp), MERKEZ_DATA_DIR: merkezDir, SERVE_BUILD: '1', MERKEZ_INITIAL_PASSWORD: ADMIN_PASSWORD } }));
  await waitFor(`${MERKEZ}/api/merkez/v1/health`, 'Mola Merkez');
  const keyFile = join(kafeDir, 'masaustu.anahtar');
  children.push(spawn(process.execPath, ['--import', 'tsx', 'scripts/test-protected-server.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...quiet,
    PORT: String(kp), DATA_DIR: join(kafeDir, 'veri'), MOLA_DESKTOP_KEY: keyFile, MOLA_TEST_OS_USER: 'kafe-pc', MOLA_CLEAN_INSTALL: '1',
    BACKUP_DIR: join(kafeDir, 'backups'), BACKUP_KEY_DIR: join(kafeDir, 'backup-keys'), BACKUP_CHECK_DIR: join(kafeDir, 'restore-checks'),
    MOLA_MERKEZ_URL: MERKEZ, MOLA_MERKEZ_PUBLIC_KEY: join(merkezDir, 'merkez-public-key.txt'), MOLA_SYNC_SOON_MS: '1000', MOLA_HEARTBEAT_MS: '2000' } }));
  await waitFor(`${KAFE}/api/health`, 'Kafe sunucusu');
  TOKEN = readFileSync(keyFile, 'utf8');
  servers.push(await siteServer(sp));
  console.log(`Merkez ${MERKEZ} · kafe ${KAFE} · site ${SITE} · ${RUN}`);
}

// ---------- Mola Merkez (the vendor approves the application) ----------
async function approve(name: string) {
  const api = await pwRequest.newContext({ baseURL: `${MERKEZ}/api/merkez/admin/` });
  const login = await api.post('login', { data: { username: 'admin', password: ADMIN_PASSWORD } });
  if (!login.ok()) throw new Error(`Merkez girişi: ${login.status()} ${await login.text()}`);
  let tenantId = '';
  for (let i = 0; i < 60 && !tenantId; i++) {
    const state = await (await api.get('state')).json() as { businesses: { name: string; tenantId: string }[] };
    tenantId = state.businesses.find(b => b.name === name)?.tenantId ?? '';
    if (!tenantId) await new Promise(r => setTimeout(r, 500));
  }
  if (!tenantId) throw new Error('Başvuru Mola Merkez’e ulaşmadı.');
  const r = await api.post('applications/approve', { data: { requestId: randomUUID().replace(/-/g, ''), tenantId } });
  if (!r.ok()) throw new Error(`Onay: ${r.status()} ${await r.text()}`);
  await api.dispose();
}

// ---------- Screens ----------
let desk: Browser;
async function deskContext() {
  const ctx = await desk.newContext({ viewport: { width: DESK.width, height: DESK.height }, deviceScaleFactor: DESK.scale, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', colorScheme: 'light' });
  await ctx.addInitScript(NO_HINTS);
  return ctx;
}
async function tabletContext() {
  const ctx = await desk.newContext({ viewport: { width: TABLET.width, height: TABLET.height }, deviceScaleFactor: TABLET.scale, hasTouch: true, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', colorScheme: 'light' });
  await ctx.addInitScript(NO_HINTS);
  return ctx;
}
/** The café computer's network address as a real install shows it (this recording server is on 127.0.0.1 only). */
async function sampleLan(ctx: BrowserContext) {
  await ctx.route('**/api/desktop/status', async route => {
    const r = await route.fetch(), body = await r.json() as Record<string, unknown>;
    await route.fulfill({ response: r, json: { ...body, lan: true, addresses: [{ name: 'Wi-Fi', origin: 'http://192.168.1.20:3000' }] } });
  });
}
const shots = join(RUN, 'ekran'); mkdirSync(shots, { recursive: true });
let shotN = 0;
async function shot(page: Page, name: string) { await page.screenshot({ path: join(shots, `${String(++shotN).padStart(2, '0')}-${name}.png`) }); }
const meta: Record<string, unknown> = {};

// ---------- The clips ----------
async function siteClip() {
  const ctx = await desk.newContext({ viewport: { width: DESK.width, height: DESK.height }, deviceScaleFactor: DESK.scale, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', colorScheme: 'light' }), page = await ctx.newPage();
  await page.goto(`${SITE}/`); await page.waitForLoadState('networkidle').catch(() => {}); await pause(page, 800);
  // Downloads never start (the edit goes on to the Downloads folder).
  await page.addInitScript(`addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[href$=".zip"],a[href$=".gz"],a[href$=".apk"]'); if (a) e.preventDefault(); }, true);`);
  const rec = new Recorder(page, join(OUT, 'k1-site'), DESK);
  await rec.start();
  rec.mark('title:' + await page.title());
  await pause(page, 2600);
  await rec.tap(page, 'nav', page.locator('#site-nav a[href="/indir/"]'), { hold: 300 });
  await page.waitForURL(/\/indir\/$/); await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(`addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[href$=".zip"],a[href$=".gz"],a[href$=".apk"]'); if (a) e.preventDefault(); }, true);`);
  rec.mark('indir');
  meta.indirTitle = await page.title();
  await pause(page, 2400);
  const card = page.locator('.dl-card[data-platform="windows"]');
  await card.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'smooth' })); await pause(page, 1400);
  rec.mark('card');
  await rec.look(page, 'card', card, 2000);
  await rec.tap(page, 'download', card.locator('a[href$=".zip"]').first(), { hold: 1600 });
  await shot(page, 'site-indir');
  await rec.stop();
  await ctx.close();
}

let mola: { ctx: BrowserContext; page: Page };
async function activationClip() {
  const ctx = await deskContext(); await sampleLan(ctx);
  const page = await ctx.newPage();
  mola = { ctx, page };
  await page.goto(`${KAFE}/#masaustu=${TOKEN}`);
  await page.getByRole('heading', { name: 'Mola’yı etkinleştir' }).waitFor({ timeout: 30000 });
  await pause(page, 1000);
  meta.molaTitle = await page.title();
  const rec = new Recorder(page, join(OUT, 'k2-etkin'), DESK);
  await rec.start();
  await pause(page, 2600);
  await rec.look(page, 'code', page.getByRole('button', { name: /Etkinleştirme kodum var/ }), 2800);
  await rec.tap(page, 'apply', page.getByRole('button', { name: /Kodum yok, başvuru yapacağım/ }), { hold: 1200 });
  rec.mark('form');
  await shot(page, 'basvuru-formu');
  const form = page.locator('form.application-form');
  await typeIn(page, rec, 'f-name', form.getByLabel(/İşletme adı/), BUSINESS);
  await rec.tap(page, 'f-sector', form.getByRole('group', { name: 'İşletme türü' }).getByRole('button', { name: 'Kafe' }), { lead: 700, hold: 500 });
  await typeIn(page, rec, 'f-legal', form.getByLabel('Ticari unvan *'), 'Örnek Kafe Gıda Ltd. Şti.');
  await typeIn(page, rec, 'f-office', form.getByLabel('Vergi dairesi *'), 'Harput');
  await typeIn(page, rec, 'f-tax', form.getByLabel(/Vergi kimlik no/), taxNumber());
  await typeIn(page, rec, 'f-city', form.getByLabel('İl *'), 'Elazığ');
  await typeIn(page, rec, 'f-district', form.getByLabel('İlçe *'), 'Merkez');
  await typeIn(page, rec, 'f-address', form.getByLabel('Açık adres *'), 'Hürriyet Cad. No: 12');
  await typeIn(page, rec, 'f-contact', form.getByLabel(/Yetkili adı soyadı/), OWNER.name);
  await typeIn(page, rec, 'f-phone', form.getByLabel(/Cep telefonu/), '0532 123 45 67');
  await typeIn(page, rec, 'f-email', form.getByLabel(/E-posta/), 'ornekkafe@example.com');
  rec.mark('typed');
  await rec.tap(page, 'consent', form.locator('.application-consent input'), { lead: 900, hold: 500 });
  const agreement = form.locator('input[type="checkbox"]').last();
  await agreement.scrollIntoViewIfNeeded(); await pause(page, 400);
  await rec.tap(page, 'agree', agreement, { lead: 2200, hold: 600 });
  await shot(page, 'basvuru-dolu');
  await rec.tap(page, 'send', form.getByRole('button', { name: /Başvuruyu gönder/ }), { hold: 200 });
  await page.getByRole('heading', { name: /Başvurunuz alındı · Onay bekleniyor/ }).waitFor({ timeout: 30000 });
  rec.mark('waiting');
  await pause(page, 1500);
  await rec.look(page, 'status', page.locator('.application-status'), 2600);
  await shot(page, 'onay-bekleniyor');
  rec.mark('approve');
  await approve(BUSINESS);
  await page.getByRole('heading', { name: 'İşletme sahibi hesabı' }).waitFor({ timeout: 60000 });
  rec.mark('owner');
  await pause(page, 1600);
  await shot(page, 'sahip-hesabi');
  await typeIn(page, rec, 'o-user', page.getByLabel(/Kullanıcı adı/), OWNER.username);
  await typeIn(page, rec, 'o-name', page.getByLabel(/Adınız/), OWNER.name);
  await typeIn(page, rec, 'o-pass', page.getByLabel(/^Şifre \*/), OWNER.password, { delay: 45 });
  await typeIn(page, rec, 'o-pass2', page.getByLabel('Şifre tekrar *', { exact: true }), OWNER.password, { delay: 45 });
  await rec.tap(page, 'create', page.getByRole('button', { name: 'Hesabı oluştur' }), { hold: 200 });
  const recovery = page.getByRole('dialog', { name: 'Kurtarma kodunuz' });
  await recovery.getByTestId('recovery-code').waitFor({ timeout: 30000 });
  rec.mark('recovery');
  await pause(page, 1200);
  await shot(page, 'kurtarma-kodu');
  const code = (await recovery.getByTestId('recovery-code').locator('span').allTextContents()).join('-');
  await rec.look(page, 'rcode', recovery.getByTestId('recovery-code'), 2600);
  await rec.tap(page, 'saved', recovery.getByRole('button', { name: 'Kaydettim', exact: true }), { hold: 1000 });
  const parts = code.split('-'), labels = recovery.locator('.recovery-groups label');
  for (let i = 0; i < 2; i++) {
    const n = Number(/^(\d)\./.exec((await labels.nth(i).textContent()) ?? '')![1]);
    await typeIn(page, rec, `g${i}`, labels.nth(i).locator('input'), parts[n - 1]);
  }
  await shot(page, 'kurtarma-onay');
  await rec.tap(page, 'confirm', recovery.getByRole('button', { name: 'Onayla' }), { hold: 300 });
  await recovery.waitFor({ state: 'detached', timeout: 15000 });
  rec.mark('wizard');
  await pause(page, 1400);
  await shot(page, 'sihirbaz');
  await rec.look(page, 'steps', page.locator('.setup-steps'), 1400);
  await rec.tap(page, 'sector', page.locator('.sector-card', { hasText: 'Kafe' }), { hold: 800 });
  await rec.tap(page, 'next1', page.getByRole('button', { name: 'Devam' }), { hold: 1200 });
  rec.mark('tables');
  await shot(page, 'sihirbaz-masa');
  const count = page.getByLabel('Toplam masa sayısı');
  await rec.tap(page, 'count', count, { lead: 900, hold: 200 });
  await count.fill(''); await count.pressSequentially('10', { delay: 120 }); await pause(page, 900);
  await rec.tap(page, 'next2', page.getByRole('button', { name: 'Devam' }), { hold: 1500 });
  rec.mark('rules');
  await shot(page, 'sihirbaz-kurallar');
  await rec.tap(page, 'next3', page.getByRole('button', { name: 'Devam' }), { hold: 1500 });
  rec.mark('summary');
  await shot(page, 'sihirbaz-ozet');
  await rec.tap(page, 'save', page.getByRole('button', { name: 'Kurulumu kaydet' }), { hold: 300 });
  await page.locator('.topbar').waitFor({ timeout: 20000 });
  rec.mark('masalar');
  await pause(page, 2400);
  await shot(page, 'masalar');
  await rec.stop();
}

async function firstSteps(page: Page, rec: Recorder) {
  const card = page.getByRole('region', { name: 'İlk adımlar' });
  await card.waitFor();
  const toggle = card.locator('.first-steps-toggle');
  if (await toggle.isVisible().catch(() => false) && (await toggle.getAttribute('aria-expanded')) !== 'true') await rec.tap(page, 'steps', toggle, { hold: 900 });
  return card;
}

async function menuClip() {
  const page = mola.page, rec = new Recorder(page, join(OUT, 'k3-menu'), DESK);
  await rec.start();
  await pause(page, 1200);
  const card = await firstSteps(page, rec);
  await rec.look(page, 'list', card, 2600);
  await rec.tap(page, 'menu', card.getByRole('button', { name: 'Menüye git' }), { hold: 600 });
  await page.locator('h1', { hasText: 'Menü yönetimi' }).waitFor();
  await imagesOnScreen(page);
  rec.mark('menu');
  await pause(page, 2600);
  await shot(page, 'menu');
  await smoothScroll(page, 260, 1100); await pause(page, 1600);
  rec.mark('scrolled');
  const row = page.locator('article, li, tr, div').filter({ has: page.getByText('Türk Kahvesi', { exact: true }) }).filter({ has: page.getByRole('button', { name: /Düzenle/ }) }).last();
  await rec.tap(page, 'edit', row.getByRole('button', { name: /Düzenle/ }), { hold: 1400 });
  rec.mark('editor');
  await shot(page, 'urun-duzenle');
  const price = page.getByRole('dialog').getByLabel('Fiyat (TL)');
  await price.scrollIntoViewIfNeeded(); await pause(page, 500);
  await rec.tap(page, 'price', price, { lead: 2200, hold: 300 });
  await price.selectText(); await pause(page, 300);
  await price.pressSequentially('100', { delay: 160 }); await pause(page, 900);
  await shot(page, 'fiyat');
  await rec.tap(page, 'save', page.getByRole('dialog').getByRole('button', { name: 'Kaydet ve yayınla' }), { hold: 300 });
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 15000 });
  rec.mark('saved');
  await pause(page, 900);
  await rec.look(page, 'row', row, 2600);
  await shot(page, 'fiyat-kaydedildi');
  await rec.stop();
}

let waiterUser = '';
async function staffClip() {
  const page = mola.page, rec = new Recorder(page, join(OUT, 'k4-personel'), DESK);
  await page.getByRole('button', { name: 'Masalar', exact: true }).first().click(); await pause(page, 1200);
  await page.evaluate('scrollTo(0, 0)');
  await rec.start();
  await pause(page, 1000);
  const card = await firstSteps(page, rec);
  await rec.tap(page, 'open', card.getByRole('button', { name: 'Hesap aç' }), { hold: 1400 });
  rec.mark('personel');
  await shot(page, 'personel');
  await rec.tap(page, 'add', page.getByRole('button', { name: 'Çalışan ekle', exact: true }).first(), { hold: 1000 });
  const dialog = page.getByRole('dialog', { name: 'Çalışan ekle' });
  await typeIn(page, rec, 'name', dialog.getByLabel('Ad soyad'), WAITER.name);
  waiterUser = await dialog.getByLabel('Yeni kullanıcı adı').inputValue();
  await pause(page, 600);
  await rec.look(page, 'role', dialog.getByLabel('Görevi'), 2200);
  await typeIn(page, rec, 'pass', dialog.getByLabel('Yeni şifre'), WAITER.password, { delay: 45 });
  await shot(page, 'calisan-ekle');
  await rec.tap(page, 'create', dialog.getByRole('button', { name: 'Hesabı oluştur' }), { hold: 300 });
  await dialog.waitFor({ state: 'detached', timeout: 15000 });
  rec.mark('created');
  await pause(page, 900);
  await rec.look(page, 'row', page.locator('.employee-row', { hasText: WAITER.name }), 2600);
  await shot(page, 'calisan-eklendi');
  await rec.stop();
  // Off camera: the kitchen screen's account (the same form, role Mutfak).
  const r = await page.request.post(`${KAFE}/api/staff/users`, { data: { name: KITCHEN.name, username: KITCHEN.username, password: KITCHEN.password, role: 'kitchen' } });
  if (!r.ok()) throw new Error(`Mutfak hesabı: ${r.status()} ${await r.text()}`);
}

async function devicesClip() {
  const page = mola.page, rec = new Recorder(page, join(OUT, 'k5-cihaz'), DESK);
  await rec.start();
  await pause(page, 1200);
  await rec.tap(page, 'rail', page.getByRole('navigation', { name: 'Mola bilgisayar araçları' }).getByRole('button', { name: /Kafe içi cihazlar/ }), { lead: 2400, hold: 1200 });
  const dialog = page.getByRole('dialog', { name: 'Kafe içi cihazlar' });
  await dialog.locator('img.desktop-qr').waitFor({ timeout: 10000 });
  rec.mark('qr');
  await pause(page, 600);
  await shot(page, 'kafe-ici-cihazlar');
  await rec.look(page, 'qr', dialog.locator('img.desktop-qr'), 3200);
  await pause(page, 800);
  await rec.stop();
  await page.keyboard.press('Escape'); await pause(page, 600);
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: /Kapat/ }).first().click();
}

let tablet: { ctx: BrowserContext; page: Page };
async function tabletClips() {
  const ctx = await tabletContext(), page = await ctx.newPage();
  tablet = { ctx, page };
  await page.goto(`${KAFE}/uygulama`);
  await page.getByRole('heading', { name: /telefona ve tablete kurun/ }).waitFor();
  await pause(page, 1500);
  const rec = new Recorder(page, join(OUT, 'k5-uygulama'), TABLET);
  await rec.start();
  await pause(page, 3000);
  await shot(page, 'tablet-uygulama');
  await rec.look(page, 'android', page.locator('.install-card').first(), 3000);
  await rec.stop();
  await page.goto(`${KAFE}/`);
  await page.getByLabel('Kullanıcı adı', { exact: true }).waitFor();
  await pause(page, 1200);
  const recL = new Recorder(page, join(OUT, 'k5-giris'), TABLET);
  await recL.start();
  await pause(page, 1500);
  await shot(page, 'tablet-giris');
  await typeIn(page, recL, 'user', page.getByLabel('Kullanıcı adı', { exact: true }), waiterUser);
  await typeIn(page, recL, 'pass', page.getByLabel('Şifre', { exact: true }), WAITER.password, { delay: 45 });
  await recL.tap(page, 'open', page.getByRole('button', { name: 'Çalışma alanını aç' }), { hold: 300 });
  await page.getByRole('button', { name: /Masa 03/ }).first().waitFor({ timeout: 20000 });
  recL.mark('in');
  await pause(page, 1500);
  const sound = page.getByText(/Ses kapalı/).first();
  if (await sound.isVisible().catch(() => false)) await recL.tap(page, 'sound', sound, { lead: 900, hold: 900 });
  await pause(page, 1500);
  await shot(page, 'tablet-masalar');
  await recL.stop();
}

async function printerClip() {
  const page = mola.page, rec = new Recorder(page, join(OUT, 'k6-yazici'), DESK);
  await page.getByRole('button', { name: 'Masalar', exact: true }).first().click(); await pause(page, 1000);
  await rec.start();
  await pause(page, 1000);
  await rec.tap(page, 'ayarlar', page.getByRole('button', { name: 'Ayarlar', exact: true }), { hold: 1100 });
  await rec.tap(page, 'topic', page.getByRole('button', { name: /^Cihazlar/ }).first(), { hold: 1100 });
  const yazicilar = page.getByRole('button', { name: /^Yazıcılar/ }).last();
  if (await yazicilar.isVisible().catch(() => false) && await yazicilar.getAttribute('aria-pressed') !== 'true' && await yazicilar.getAttribute('aria-selected') !== 'true') await rec.tap(page, 'part', yazicilar, { hold: 1100 });
  rec.mark('page');
  await shot(page, 'yazicilar');
  await rec.tap(page, 'add', page.locator('.printer-card.add'), { hold: 1100 });
  const dialog = page.getByRole('dialog', { name: 'Yazıcı ekle' });
  await shot(page, 'yazici-ekle');
  await typeIn(page, rec, 'name', dialog.getByLabel(/Yazıcı adı/), 'Mutfak');
  await rec.look(page, 'conn', dialog.getByRole('group', { name: 'Bağlantı türü' }), 2000);
  const ip = dialog.getByLabel(/IP adresi/);
  await ip.scrollIntoViewIfNeeded(); await pause(page, 300);
  await rec.tap(page, 'ip', ip, { lead: 2200, hold: 200 });
  await ip.pressSequentially('192.168.1.50', { delay: 70 }); await pause(page, 700);
  const width = dialog.getByRole('group', { name: 'Kâğıt genişliği' }).getByRole('button', { name: '80 mm' });
  await rec.tap(page, 'width', width, { lead: 900, hold: 600 });
  const orders = dialog.getByRole('checkbox', { name: /Mutfak fişleri/ });
  await orders.scrollIntoViewIfNeeded(); await pause(page, 300);
  if (!(await orders.isChecked())) await rec.tap(page, 'orders', orders, { lead: 900, hold: 600 });
  else await rec.look(page, 'orders', orders, 1600);
  await shot(page, 'yazici-dolu');
  await rec.tap(page, 'save', dialog.getByRole('button', { name: 'Kaydet' }), { hold: 300 });
  await dialog.waitFor({ state: 'detached', timeout: 15000 });
  rec.mark('saved');
  await pause(page, 1000);
  await rec.look(page, 'card', page.locator('.printer-card').filter({ hasText: 'Mutfak' }).first(), 2600);
  await shot(page, 'yazici-kaydedildi');
  await rec.stop();
  // Off camera: no printer stands at 192.168.1.50, so it is switched off ("Yazıcı açık"): its tickets would fail on the next screens.
  await page.locator('.printer-card').filter({ hasText: 'Mutfak' }).first().getByRole('button', { name: /yazıcısını düzenle/ }).click();
  const edit = page.getByRole('dialog', { name: 'Yazıcıyı düzenle' });
  await edit.getByRole('checkbox', { name: 'Yazıcı açık' }).uncheck();
  await edit.getByRole('button', { name: 'Kaydet' }).click();
  await edit.waitFor({ state: 'detached', timeout: 15000 });
}

async function buttonsOf(page: Page, name: string) {
  const names = await page.getByRole('button').evaluateAll(list => list.filter(b => (b as HTMLElement).offsetParent).map(b => (b.getAttribute('aria-label') || b.textContent || '').trim()).filter(Boolean));
  writeFileSync(join(shots, `dugmeler-${name}.txt`), names.join('\n'));
}
async function firstOrderClips() {
  // The kitchen screen: its own account on a display in the kitchen.
  const kctx = await deskContext(), kitchen = await kctx.newPage();
  await kitchen.goto(`${KAFE}/`);
  await kitchen.getByLabel('Kullanıcı adı', { exact: true }).fill(KITCHEN.username);
  await kitchen.getByLabel('Şifre', { exact: true }).fill(KITCHEN.password);
  await kitchen.getByRole('button', { name: 'Çalışma alanını aç' }).click();
  await pause(kitchen, 2500);
  await kitchen.mouse.click(640, 20); await pause(kitchen, 400);
  const ks = kitchen.getByText(/Ses kapalı/).first(); if (await ks.isVisible().catch(() => false)) { await ks.click(); await pause(kitchen, 400); }
  await shot(kitchen, 'mutfak-bos');
  const page = tablet.page, rec = new Recorder(page, join(OUT, 'k7-garson'), TABLET), recK = new Recorder(kitchen, join(OUT, 'k7-mutfak'), DESK);
  await rec.start(); await recK.start();
  await pause(page, 1200);
  await rec.tap(page, 'table', page.getByRole('button', { name: /Masa 03/ }).first(), { hold: 1200 });
  await shot(page, 'garson-masa');
  await buttonsOf(page, 'garson-masa');
  const add = page.getByRole('button', { name: 'Sipariş ekle' }).first();
  if (await add.isVisible().catch(() => false)) await rec.tap(page, 'add', add, { hold: 1500 });
  await imagesOnScreen(page);
  await shot(page, 'garson-urunler');
  await buttonsOf(page, 'garson-urunler');
  rec.mark('products');
  for (const [i, name] of ['Türk Kahvesi', 'San Sebastian'].entries()) {
    const product = page.getByRole('button', { name: new RegExp(name) }).first();
    await rec.tap(page, `p${i}`, product, { hold: 1100 });
    const sheetAdd = page.getByRole('button', { name: /Sepete ekle/ }).first();
    if (await sheetAdd.isVisible().catch(() => false)) { await shot(page, `garson-secenek-${i}`); await rec.tap(page, `p${i}add`, sheetAdd, { hold: 900 }); }
  }
  await shot(page, 'garson-sepet');
  await buttonsOf(page, 'garson-sepet');
  const open = page.getByRole('button', { name: /Sepeti görüntüle/ }).first();
  if (await open.isVisible().catch(() => false)) await rec.tap(page, 'cart', open, { hold: 1200 });
  await shot(page, 'garson-sepet-acik');
  await buttonsOf(page, 'garson-sepet-acik');
  await rec.tap(page, 'send', page.getByRole('button', { name: /^(Siparişi gönder|Gönder|Mutfağa gönder)$/ }).first(), { hold: 300 });
  rec.mark('sent');
  await kitchen.locator('.kitchen-card').first().waitFor({ timeout: 20000 });
  recK.mark('ticket');
  await pause(page, 2400);
  await shot(page, 'garson-gonderildi');
  await shot(kitchen, 'mutfak-fis');
  await buttonsOf(kitchen, 'mutfak');
  await pause(kitchen, 1200);
  await recK.look(kitchen, 'ticket', kitchen.locator('.kitchen-card').first(), 2400);
  const step = kitchen.locator('.kitchen-card').first().locator('button.kitchen-step').first();
  if (await step.isVisible().catch(() => false)) { await recK.tap(kitchen, 'start', step, { hold: 1500 }); await shot(kitchen, 'mutfak-adim1'); }
  const step2 = kitchen.locator('.kitchen-card').first().locator('button.kitchen-step').first();
  if (await step2.isVisible().catch(() => false)) { await recK.tap(kitchen, 'ready', step2, { hold: 1800 }); await shot(kitchen, 'mutfak-adim2'); }
  await recK.stop(); await rec.stop();
  await kctx.close();

  // The payment at the counter: the Mola window (the owner); first the day's cash opening.
  const owner = mola.page, recC = new Recorder(owner, join(OUT, 'k7-kasa'), DESK);
  await owner.getByRole('button', { name: 'Masalar', exact: true }).first().click(); await pause(owner, 1500);
  await owner.evaluate('scrollTo(0, 0)');
  // "İlk adımlar" folded to its one line, so the tables stay in sight.
  const fold = owner.locator('.first-steps-toggle');
  if (await fold.isVisible().catch(() => false) && (await fold.getAttribute('aria-expanded')) === 'true') { await fold.click(); await pause(owner, 800); }
  await recC.start();
  await pause(owner, 1200);
  await shot(owner, 'kasa-masalar');
  const cashIn = owner.getByPlaceholder('Örn. 500');
  if (await cashIn.isVisible().catch(() => false)) {
    await typeIn(owner, recC, 'cash', cashIn, '500');
    await recC.tap(owner, 'cashSave', owner.getByRole('button', { name: 'Açılışı kaydet' }), { hold: 1500 });
    recC.mark('cashOpen');
  }
  await shot(owner, 'kasa-acildi');
  await recC.tap(owner, 'table', owner.locator('.table-card', { hasText: 'Masa 03' }).first(), { hold: 1400 });
  await shot(owner, 'kasa-masa');
  await buttonsOf(owner, 'kasa-masa');
  await recC.tap(owner, 'pay', owner.getByRole('dialog').getByRole('button', { name: /Ödeme al/ }).first(), { hold: 1400 });
  await shot(owner, 'odeme');
  await buttonsOf(owner, 'odeme');
  const pay = owner.getByRole('dialog', { name: /Ödeme al/ });
  await recC.tap(owner, 'cashMethod', pay.locator('.payment-method button').first(), { hold: 900 });
  await recC.tap(owner, 'confirm', pay.getByRole('button', { name: /Ödemeyi kaydet/ }), { hold: 300 });
  await pay.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  recC.mark('paid');
  await pause(owner, 2000);
  await shot(owner, 'odendi');
  await buttonsOf(owner, 'odendi');
  await recC.stop();
  await owner.keyboard.press('Escape'); await pause(owner, 500);
}

async function packageClip() {
  const page = mola.page, rec = new Recorder(page, join(OUT, 'k8-paket'), DESK);
  await page.getByRole('button', { name: 'Masalar', exact: true }).first().click(); await pause(page, 1000);
  await rec.start();
  await pause(page, 1000);
  await rec.tap(page, 'ayarlar', page.getByRole('button', { name: 'Ayarlar', exact: true }), { hold: 1100 });
  await rec.tap(page, 'topic', page.getByRole('button', { name: /^İşletme( |$)/ }).first(), { hold: 1100 });
  await rec.tap(page, 'part', page.getByRole('button', { name: 'Paket ve lisans', exact: true }).last(), { hold: 1400 });
  rec.mark('page');
  await shot(page, 'paket');
  await rec.look(page, 'status', page.getByTestId('package-status'), 3600);
  meta.packageStatus = await page.getByTestId('package-status').textContent();
  await smoothScroll(page, 300, 1200); await pause(page, 1800);
  await shot(page, 'paket-asagi');
  await rec.stop();
}

async function main() {
  await startServers();
  desk = await chromium.launch({ channel: 'chrome', args: [`--force-device-scale-factor=${DESK.scale}`] });
  try {
    console.log('Kayıt: k1-site'); await siteClip();
    console.log('Kayıt: k2-etkin'); await activationClip();
    console.log('Kayıt: k3-menu'); await menuClip();
    console.log('Kayıt: k4-personel'); await staffClip();
    console.log('Kayıt: k5-cihaz'); await devicesClip();
    console.log('Kayıt: k5-tablet'); await tabletClips();
    console.log('Kayıt: k6-yazici'); await printerClip();
    console.log('Kayıt: k7-siparis'); await firstOrderClips();
    console.log('Kayıt: k8-paket'); await packageClip();
  } finally {
    writeFileSync(join(OUT, 'bilgi.json'), JSON.stringify(meta, null, 1));
    await desk?.close().catch(() => {});
    stopAll();
  }
}
await main();
