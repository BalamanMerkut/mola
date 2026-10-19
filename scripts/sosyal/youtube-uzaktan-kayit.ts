/*
 * YouTube 05 "Uzaktan erişim ve güvenlik" (introduction series, the last one): recordings of the REAL app for one linear story
 * (edit: scripts/sosyal/youtube-uzaktan-kurgu.ts). One run in story order on a fresh Mola Merkez + demo café ("Mola Örnek
 * Kafe", shared parts: scripts/sosyal/kayit-ortak.ts) in .local/sosyal/youtube/uzaktan/run-<zaman>/.
 *
 * The café runs as the café computer's own Mola window starts it (kit({ desktop }): the side rail, key protection, automatic
 * backups in the run folder); Mola Merkez names İşletmemi yönet's own address (kit({ ownerOrigin }): isletme.molayazilim.com.tr,
 * answered by the run's Merkez); the café's internet can be cut (kit({ internet })). The run plays on the recording clock: 30
 * days of history up to yesterday evening, yesterday's gün sonu (its backup a minute later), this morning's tables off camera
 * (the recovery code is saved off camera, a kitchen printer is added and switched off). Then:
 *
 *   u1-kurulum   11:40 the owner on the café computer: Ayarlar → Uzaktan erişim (five cards) → 1 · Telefon kodu (password,
 *                "Telefon kodunu kur", the authenticator QR, its 6-digit code, the kurtarma kodları, "Kodları sakladım") →
 *                2 · E-posta (address, password, "Kod gönder", the e-mailed code, "Doğrula") → 3 · Cihaz eşleştirme (the address)
 *                → at 11:50 5 · Uzaktan yönetim "Aç" (password, phone code) → "Açık". Secrets are blurred in the edit (boxes).
 *   p1-giris     14:20 the owner's iPhone: isletme.molayazilim.com.tr → e-posta, şifre → "Devam" → telefon kodu → "Giriş yap"
 *                → the café's screens ("Uzaktan"), the login notification → "Raporlar" (Canlı, today) → "İşletmeyi yönet".
 *   p2-fiyat     the same phone: Daha fazla → Menü yönetimi → Caffè Latte → Fiyat → "Kaydet ve yayınla".
 *   g1-misafir   a guest's phone at Masa 03: Kahveler with the new price.
 *   p3-kesinti   14:26 the café's internet is cut: the phone in the screens → "Bağlantı koptu" → the last state.
 *   t1-tablet    the waiter's tablet at the café meanwhile: Masa 05 → an order → "Siparişi gönder" (works on the café's Wi-Fi).
 *   p4-geri      the internet back: "Kasa açıldı · ekranlar hazır" → "Çıkış" → "Evet, çıkış yap" (the device locked, remembered).
 * Off camera: the owner's laptop signs in too (a second device).
 *   s2-cihazlar  14:40 the café computer: the bell (Uzaktan yönetim girişi) → Ayarlar → Uzaktan erişim → 4 · Eşleşmiş cihazlar
 *                → the laptop "Kaldır" → password → "Evet, kaldır"; 5 · Uzaktan yönetim.
 *   s3-oturumlar Personel → Açık oturumlar → a waiter's tablet "Oturumu kapat".
 *   s4-kafeici   the rail's "Kafe içi cihazlar" (the café's Wi-Fi address shown as a real install shows it: a sample LAN address,
 *                the recording server listens on 127.0.0.1 only, as in video 06).
 *   s5-yedek     Ayarlar → Güvenlik ve yedek → Yedek (where the backups are) → the rail's "Yedekle" → "Şimdi yedekle" →
 *                Saklanan yedekler → the rail's "Güvenlik" (recovery code, owner password).
 *   s6-destek    Destek → Mola desteği → "Mola ekibi bağlanabilsin" → password → "İzni aç"; what the team can and cannot do.
 *   s7-kasa      Kasa ve giderler → Kasa ayarları → Kasa güvenliği → "Önerilenleri aç".
 *
 *   npx tsx scripts/sosyal/youtube-uzaktan-kayit.ts            (needs `npm run build`; ~30 minutes)
 *   UZAKTAN_HIZLI=1 …                                           a quick rehearsal (5 days of history)
 *
 * No pointer: every tap goes through Recorder.tap (box saved, a still lead-in the edit cuts). Mola window 1280×800 (2×),
 * phones 390×844 (3×), the waiter's tablet 1180×820 (2×). Ports: café 3796, Mola Merkez 3797. Every process is stopped at the
 * end. Output: .local/sosyal/youtube/uzaktan/kayit/<klip>/ (meta.json), kayit/bilgi.json and kayit/kapak-telefon.png.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DESKTOP, NO_HINTS, PASSWORD, PHONE, ROOT, Recorder, TABLET, bring, bringIn, dialog, imagesOnScreen, istanbul, kit, nav, pause, retype, smoothScroll, tableCard, typeIn, type Want } from './kayit-ortak';

const BASE = join(ROOT, '.local', 'sosyal', 'youtube', 'uzaktan');
const OUT = join(BASE, 'kayit');
const FAST = !!process.env.UZAKTAN_HIZLI;
const run = join(BASE, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const k = kit({ run, kafePort: 3796, merkezPort: 3797, saat: istanbul(-1, 22, 10), gun: FAST ? 5 : 30, desktop: true, ownerOrigin: 'https://isletme.molayazilim.com.tr', internet: true });
mkdirSync(OUT, { recursive: true });
const info: Record<string, unknown> = {};
/** The demo owner's (Serkan Yıldız) e-mail: only the run's fake SMTP server ever sees it. */
const EMAIL = 'serkan@ornekkafe.com';
/** The owner's phone names itself after its browser: "iPhone · 19 Ekim". */
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
/** The waiter's own Android tablet ("Kaybolan tablet" in Açık oturumlar). */
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X210) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
/** The product whose price the owner changes from home, and the new price (TL). */
const PRODUCT = 'Caffè Latte';
const MORNING: { table: string; at: number; lines: Want[]; method: 'cash' | 'card' }[] = [
  { table: 'Masa 02', at: 8 * 60 + 45, lines: [['Türk Kahvesi', 2], ['Demleme Çay', 2]], method: 'cash' },
  { table: 'Masa 06', at: 9 * 60 + 30, lines: [['Caffè Latte', 2], ['San Sebastian', 1]], method: 'card' },
  { table: 'Masa 09', at: 10 * 60 + 15, lines: [['Americano', 2], ['Künefe', 1]], method: 'card' },
  { table: 'Masa 11', at: 11 * 60, lines: [['Ev Yapımı Limonata', 2], ['Çikolatalı Brownie', 1]], method: 'card' },
];

const topicTab = (page: Page, id: string) => page.locator(`[data-topic="${id}"]`).first();
const partTab = (page: Page, id: string) => page.locator(`[data-part="${id}"]`).first();
const card = (page: Page, title: string) => page.locator('.settings-card', { has: page.getByRole('heading', { name: title }) }).first();
const rail = (page: Page, name: RegExp) => page.locator('.desktop-rail').getByRole('button', { name });
/** The run's clock moved on to hh:mm today (only forward: a clip that took longer keeps its own time). */
const later = async (hh: number, mm: number) => { if (istanbul(0, hh, mm) > k.now() + 1000) await k.setClock(istanbul(0, hh, mm)); };
const status = async (p: Locator) => (await p.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();

async function main() {
  await k.launch();
  const desk = k.deskBrowser;
  try {
    await k.startServers();
    // The data's recovery code was saved on paper at the installation (off camera): no reminders on the screens.
    { const token = k.desktopHash().split('=')[1];
      const r = await fetch(`${k.KAFE}/api/desktop/recovery/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mola-Desktop': token }, body: '{}' });
      if (!r.ok) throw new Error(`Kurtarma kodu onaylanamadı: ${r.status} ${await r.text()}`); }
    await k.prepareMenu(desk, { waiterApproval: false, changeSeconds: 0 });
    await k.calm(desk, true);
    const owner = async <T>(fn: (req: Awaited<ReturnType<typeof k.ownerApi>>['req']) => Promise<T>) => { const api = await k.ownerApi(desk); try { return await fn(api.req); } finally { await api.close(); } };
    // A kitchen printer as a café has one (switched off: there is none at this address in the recording).
    await owner(req => k.post(req, '/api/staff/printers', { printer: { name: 'Mutfak', enabled: false, connection: { type: 'network', host: '192.168.1.50', port: 9100 }, width: 80, charset: 'pc857', orders: true, categories: [], bill: false } }));
    const s0 = await owner(req => k.state(req));
    const token = (table: string) => s0.tables.find(t => t.name === table)!.token;
    info.prices = Object.fromEntries(s0.products.filter(p => p.published !== false).map(p => [p.name, p.price / 100]));
    const oldPrice = s0.products.find(p => p.name === PRODUCT)!.price / 100, newPrice = oldPrice + 10;
    info.newPrice = newPrice;
    // Yesterday evening (off camera): the floor settled, the gün sonu (its backup comes a minute later).
    await k.settleAll();
    info.closing = await k.closeKasa();
    await new Promise(r => setTimeout(r, 75_000));

    // ===== This morning (off camera): the kasa opened, the morning's tables, two tables still at lunch =====
    await k.setClock(istanbul(0, 8, 20));
    await k.openKasa(50000);
    await k.serveDay(FAST ? MORNING.slice(0, 2) : MORNING);
    await later(11, 38);
    await k.readNotifications();

    // ===== u1: Ayarlar → Uzaktan erişim, set up on the café computer =====
    await later(11, 40);
    let w = await k.ownerWindow(), op = w.page;
    console.log('Kayıt: u1-kurulum');
    { const rec = new Recorder(op, join(OUT, 'u1-kurulum'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', nav(op, 'Ayarlar'), { hold: 1200 });
      await rec.tap(op, 'topic', topicTab(op, 'remote'), { hold: 1500 });
      rec.mark('page');
      await rec.look(op, 'cards', op.locator('.remote-access'), 2600);
      // 1 · Telefon kodu: the password, then the authenticator app's QR and its code.
      const setup = op.locator('form[aria-label="Telefon kodunu kur"]');
      await typeIn(op, rec, 'pw1', setup.getByLabel('Şifreniz'), PASSWORD, { delay: 70 });
      const answer = op.waitForResponse(r => r.url().endsWith('/api/staff/report-security/setup'));
      await rec.tap(op, 'kur', setup.getByRole('button', { name: 'Telefon kodunu kur' }), { hold: 900 });
      const code = k.phoneCodes(((await (await answer).json()) as { secret: string }).secret);
      nextCode = code;
      const confirm = op.locator('form[aria-label="Telefon kodunu onayla"]'), qr = confirm.locator('img.remote-code-qr');
      await qr.waitFor({ timeout: 15000 }); await pause(op, 500);
      await bring(op, confirm, 150, 700);
      rec.mark('qr');
      await rec.box('qr', qr);
      await rec.look(op, 'qrLook', qr, 3000);
      const field1 = confirm.getByLabel('Uygulamadaki 6 haneli kod');
      await rec.box('code1', field1);
      rec.mark('code1');
      await typeIn(op, rec, 'code1', field1, await code(), { delay: 140 });
      // App bug (reported): the page's 8-second refresh replaces the one-time kurtarma kodları with "Kurulu ✓" at once, even
      // before "Kodları sakladım". While they are on screen here that refresh waits (only its answer is held back).
      let holdView = true;
      await op.route('**/api/staff/remote-reports', async route => { while (holdView) await new Promise(r => setTimeout(r, 200)); await route.continue().catch(() => {}); });
      await rec.tap(op, 'onay', confirm.getByRole('button', { name: 'Kodu onayla' }), { hold: 900 });
      const codes = op.getByLabel('Kurtarma kodları');
      await codes.waitFor({ timeout: 15000 }); await pause(op, 400);
      rec.mark('codes');
      await rec.box('codes', codes);
      await rec.look(op, 'codesLook', codes, 3200);
      await rec.tap(op, 'sakladim', op.getByRole('button', { name: 'Kodları sakladım' }), { hold: 300 });
      holdView = false; await pause(op, 900); await op.unroute('**/api/staff/remote-reports');
      await op.getByText('Kurulu ✓').first().waitFor({ timeout: 15000 });
      rec.mark('done1');
      // 2 · E-posta: the address the devices sign in with, verified with a code sent to it.
      const mailForm = op.locator('form[aria-label="E-postanızı doğrulayın"]');
      await bring(op, mailForm, 150, 1000);
      rec.mark('mail');
      const mail = await k.merkezMail();
      try {
        await typeIn(op, rec, 'email', mailForm.getByLabel('E-posta'), EMAIL, { delay: 70 });
        await typeIn(op, rec, 'pw2', mailForm.getByLabel('Şifreniz'), PASSWORD, { delay: 60 });
        await rec.tap(op, 'gonder', mailForm.getByRole('button', { name: 'Kod gönder' }), { hold: 900 });
        const verify = op.locator('form[aria-label="E-postayı doğrula"]');
        await verify.waitFor({ timeout: 20000 });
        await bring(op, verify, 150, 700);
        rec.mark('mailCode');
        const field2 = verify.getByLabel('E-postadaki kod');
        await rec.box('code2', field2);
        await typeIn(op, rec, 'code2', field2, await mail.code(EMAIL), { delay: 140 });
        await rec.tap(op, 'dogrula', verify.getByRole('button', { name: 'Doğrula' }), { hold: 900 });
        await op.locator('.remote-done', { hasText: '@' }).first().waitFor({ timeout: 20000 });
      } finally { await mail.close(); }
      rec.mark('done2');
      await pause(op, 900);
      // 3 · Cihaz eşleştirme: the address every device signs in at.
      const address = op.locator('.remote-connect');
      await address.waitFor({ timeout: 20000 });
      await bring(op, address, 220, 1000);
      rec.mark('address');
      await rec.look(op, 'addressLook', address, 3200);
      info.address = await status(address);
      // 5 · Uzaktan yönetim: "Aç" with the password and the phone code (at 11:50: "Açık · 19 Ekim 11:50'den beri").
      const admin = op.locator('.remote-admin-settings');
      await bring(op, admin, 150, 1000);
      rec.mark('admin');
      await rec.look(op, 'adminLook', admin, 2400);
      await k.setClock(istanbul(0, 11, 50));
      await rec.tap(op, 'ac', admin.getByRole('button', { name: 'Aç', exact: true }), { lead: 2400, hold: 1100 });
      const on = admin.locator('form[aria-label="Uzaktan yönetimi aç"]');
      await on.waitFor({ timeout: 15000 });
      // The whole form in view first (its button too): the code field stays where its blur is.
      await bring(op, on, 200, 800);
      rec.mark('adminForm');
      await typeIn(op, rec, 'pw3', on.getByLabel('Şifreniz'), PASSWORD, { delay: 60 });
      const field3 = on.getByLabel('Telefon kodu');
      await rec.box('code3', field3);
      await typeIn(op, rec, 'code3', field3, await code(), { delay: 140 });
      await rec.tap(op, 'acik', on.getByRole('button', { name: 'Uzaktan yönetimi aç' }), { hold: 1200 });
      await admin.getByText(/^Açık/).first().waitFor({ timeout: 20000 });
      rec.mark('adminOn');
      await rec.look(op, 'adminOnLook', admin, 3600);
      info.adminState = await status(admin);
      await rec.stop(); }
    await w.ctx.close();
    await k.ownerReady(EMAIL);

    // Lunch (off camera): two tables still eating while the owner looks from home.
    await later(13, 10);
    await k.order('Masa 04', [['Americano', 2], ['San Sebastian', 1]]);
    await k.order('Masa 07', [['Demleme Çay', 3], ['Fırın Sütlaç', 1]]);
    await k.advance(['preparing', 'ready', 'served']);

    // The waiter's tablet is on at the café all afternoon (QR orders need a staff screen connected).
    const waiter = await k.staffScreen('garson', 'tablet');

    // ===== p1: İşletmemi yönet on the owner's iPhone (sign-in at 14:20: "… 14:20'de kafeye uzaktan girildi") =====
    await k.setClock(istanbul(0, 14, 20));
    const phone = await k.ownerDevice({ userAgent: IPHONE }), tel = phone.page;
    await tel.evaluate(NO_HINTS); await pause(tel, 1500);
    console.log('Kayıt: p1-giris');
    { const rec = new Recorder(tel, join(OUT, 'p1-giris'), PHONE);
      await rec.start(); await pause(tel, 1400);
      const login = tel.getByRole('form', { name: 'Giriş yap' });
      await typeIn(tel, rec, 'email', login.getByLabel('E-posta'), EMAIL, { delay: 70 });
      await typeIn(tel, rec, 'pw', login.getByLabel('Şifre', { exact: true }), PASSWORD, { delay: 60 });
      await rec.tap(tel, 'devam', login.getByRole('button', { name: 'Devam' }), { hold: 600 });
      const codeForm = tel.getByRole('form', { name: 'Telefon kodu' });
      await codeForm.waitFor({ timeout: 30000 }); await pause(tel, 700);
      rec.mark('code');
      const field = codeForm.getByLabel('Telefon kodu');
      await rec.box('code', field);
      rec.mark('codeTyping');
      // The code field has the focus already (the keyboard stays up): typed as on the phone.
      const c = await nextCode();
      await field.pressSequentially(c, { delay: 150 });
      await pause(tel, 300);
      await rec.tap(tel, 'giris', codeForm.getByRole('button', { name: 'Giriş yap' }), { hold: 300 });
      const bar = tel.getByRole('region', { name: 'Uzaktan yönetim' });
      await bar.waitFor({ timeout: 40000 });
      await tel.locator('.table-card, .floor-compact').first().waitFor({ timeout: 30000 }).catch(() => {});
      await pause(tel, 1200);
      rec.mark('screens');
      // The login notification on the screens themselves (also on the café computer's bell).
      const toast = tel.getByText('Uzaktan yönetim girişi').first();
      if (await toast.isVisible().catch(() => false)) {
        rec.mark('toast');
        await rec.look(tel, 'toast', toast, 3000);
        const x = tel.getByRole('button', { name: 'Bildirim uyarısını kapat' }).first();
        if (await x.isVisible().catch(() => false)) await rec.tap(tel, 'toastX', x, { lead: 500, hold: 900 });
      }
      await rec.look(tel, 'floor', tel.locator('main').first(), 2200);
      await rec.tap(tel, 'raporlar', bar.getByRole('button', { name: 'Raporlar' }), { hold: 1200 });
      const hero = tel.getByRole('region', { name: 'Bugünün satışı' });
      await hero.waitFor({ timeout: 30000 }); await pause(tel, 1200);
      rec.mark('report');
      await rec.look(tel, 'live', tel.locator('.rp-bar'), 2600);
      await tel.screenshot({ path: join(OUT, 'kapak-telefon.png') });
      info.reportTop = await status(tel.locator('.rp-page'));
      await smoothScroll(tel, 520, 1500); await pause(tel, 500);
      rec.mark('down');
      await rec.look(tel, 'downLook', tel.locator('.rp-page'), 2800);
      await smoothScroll(tel, -520, 1200); await pause(tel, 600);
      rec.mark('up');
      await rec.tap(tel, 'yonet', tel.getByRole('button', { name: /^İşletmeyi yönet/ }).first(), { lead: 1400, hold: 1200 });
      await bar.waitFor({ timeout: 30000 }); await pause(tel, 1500);
      rec.mark('back');
      await rec.stop(); }

    // ===== p2: a price changed from home =====
    console.log('Kayıt: p2-fiyat');
    { const rec = new Recorder(tel, join(OUT, 'p2-fiyat'), PHONE);
      await rec.start(); await pause(tel, 1200);
      await rec.tap(tel, 'more', tel.locator('.bottom-nav').getByRole('button', { name: /Daha fazla/ }), { hold: 1100 });
      await rec.tap(tel, 'menu', tel.locator('.bottom-sheet').getByRole('button', { name: /Menü yönetimi/ }), { hold: 1600 });
      const row = tel.locator('article.menu-row', { hasText: PRODUCT }).first();
      await row.waitFor({ timeout: 20000 });
      await bring(tel, row, 260, 900);
      rec.mark('list');
      await rec.look(tel, 'row', row, 2200);
      info.rowBefore = await status(row);
      await rec.tap(tel, 'edit', row.getByRole('button', { name: /Düzenle/ }), { hold: 1500 });
      const editor = dialog(tel), price = editor.getByLabel('Fiyat (TL)');
      await price.waitFor({ timeout: 20000 });
      await price.scrollIntoViewIfNeeded(); await pause(tel, 600);
      rec.mark('editor');
      await retype(tel, rec, 'price', price, String(newPrice), 160);
      await pause(tel, 600);
      rec.mark('typed');
      await rec.tap(tel, 'save', editor.getByRole('button', { name: 'Kaydet ve yayınla' }), { lead: 1200, hold: 300 });
      await editor.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
      await pause(tel, 1200);
      await bring(tel, row, 260, 700);
      rec.mark('saved');
      await rec.look(tel, 'rowAfter', row, 3000);
      info.rowAfter = await status(row);
      await rec.stop(); }

    // ===== g1: the guest's menu at the café shows the new price =====
    await later(14, 24);
    console.log('Kayıt: g1-misafir');
    { const ctx = await k.phoneContext(); await ctx.addInitScript('window.__molaNoFinger = true');
      const g = await ctx.newPage();
      await k.openMenu(g, token('Masa 03'));
      const rec = new Recorder(g, join(OUT, 'g1-misafir'), PHONE);
      await rec.start(); await pause(g, 1200);
      await rec.tap(g, 'kahveler', g.locator('.category-tabs').getByRole('button', { name: 'Kahveler' }), { hold: 900 });
      await bring(g, g.locator('.product-grid'), 24, 1100); await imagesOnScreen(g);
      rec.mark('kahveler');
      await rec.look(g, 'card', g.locator('.product-card', { hasText: PRODUCT }).first(), 3600);
      info.guestCard = await status(g.locator('.product-card', { hasText: PRODUCT }).first());
      await rec.stop();
      await ctx.close(); }

    // ===== p3: the café's internet is cut while the owner is in the screens =====
    await tel.locator('.bottom-nav').getByRole('button', { name: /Masalar/ }).click(); await pause(tel, 1500);
    await tel.evaluate('scrollTo(0, 0)'); await pause(tel, 800);
    await later(14, 26);
    console.log('Kayıt: p3-kesinti');
    { const rec = new Recorder(tel, join(OUT, 'p3-kesinti'), PHONE);
      await rec.start(); await pause(tel, 1600);
      k.setInternet(false);
      rec.mark('cut');
      const drop = tel.getByRole('alertdialog', { name: 'Bağlantı koptu' });
      await drop.waitFor({ timeout: 180000 });
      rec.mark('dropped');
      info.dropped = await status(drop);
      await tel.locator('.rp-status.off').first().waitFor({ timeout: 30000 });
      await pause(tel, 800);
      rec.mark('offline');
      await rec.look(tel, 'offLine', tel.locator('.rp-bar'), 3200);
      info.offline = await status(tel.locator('.rp-page'));
      await rec.look(tel, 'offHero', tel.getByRole('region', { name: 'Bugünün satışı' }), 2400);
      await rec.stop(); }

    // ===== t1: at the café, the waiter's tablet takes an order on the Wi-Fi meanwhile =====
    await later(14, 28);
    console.log('Kayıt: t1-tablet');
    { const tp = waiter.page;
      await tp.evaluate('scrollTo(0, 0)'); await pause(tp, 800);
      const rec = new Recorder(tp, join(OUT, 't1-tablet'), TABLET);
      await rec.start(); await pause(tp, 1200);
      await rec.tap(tp, 'table', tableCard(tp, 'Masa 05'), { hold: 1400 });
      await rec.tap(tp, 'add', dialog(tp).getByRole('button', { name: /Sipariş ekle/ }), { hold: 1400 });
      await rec.tap(tp, 'cat', tp.locator('.category-tabs').getByRole('button', { name: 'Kahveler' }), { hold: 1000 });
      await rec.tap(tp, 'item', tp.locator('.staff-card', { has: tp.locator('.staff-card-name', { hasText: /^Türk Kahvesi$/ }) }).first(), { hold: 1100 });
      const d = tp.getByRole('dialog').last();
      await rec.tap(tp, 'more', d.getByRole('button', { name: 'Adedi artır' }), { lead: 500, hold: 500 });
      await rec.tap(tp, 'toCart', d.getByRole('button', { name: /Sepete ekle/ }), { hold: 1000 });
      await rec.tap(tp, 'cart', tp.locator('.staff-basket-open'), { hold: 1300 });
      await rec.tap(tp, 'send', dialog(tp).getByRole('button', { name: /Siparişi gönder/ }), { hold: 300 });
      await tp.getByText(/mutfağa gönderildi/).first().waitFor({ timeout: 15000 }).catch(() => {});
      rec.mark('sent'); await pause(tp, 2200);
      info.tabletSent = await status(tp.locator('body'));
      await rec.stop(); }

    // ===== p4: the internet back: "Kasa açıldı"; Çıkış locks this phone =====
    await later(14, 31);
    console.log('Kayıt: p4-geri');
    { const rec = new Recorder(tel, join(OUT, 'p4-geri'), PHONE);
      await rec.start(); await pause(tel, 1400);
      k.setInternet(true);
      rec.mark('on');
      const back = tel.locator('.rp-banner.back');
      await back.waitFor({ timeout: 180000 }); await pause(tel, 600);
      rec.mark('back');
      await rec.look(tel, 'banner', back, 3200);
      info.back = await status(tel.locator('.rp-page'));
      await rec.tap(tel, 'cikis', tel.locator('.rp-logout'), { hold: 1200 });
      rec.mark('ask');
      await rec.look(tel, 'askLook', tel.getByRole('group', { name: 'Çıkış' }), 2600);
      await rec.tap(tel, 'evet', tel.getByRole('button', { name: 'Evet, çıkış yap' }), { hold: 1500 });
      await tel.getByRole('form', { name: 'Giriş yap' }).waitFor({ timeout: 20000 });
      await pause(tel, 600);
      rec.mark('locked');
      await rec.look(tel, 'lockedLook', tel.getByRole('form', { name: 'Giriş yap' }), 3600);
      info.locked = await status(tel.locator('.rp-page'));
      await rec.stop(); }
    await phone.ctx.close();

    // Off camera: the owner's laptop signs in too (a second device: "Windows laptop · 19 Ekim").
    // At 14:37 (the café's notification reads "… 14:37'de kafeye uzaktan girildi").
    if (k.now() >= istanbul(0, 14, 37)) throw new Error('İkinci cihaz 14:37’den önce girmeliydi.');
    await k.setClock(istanbul(0, 14, 37));
    { const laptop = await k.ownerDevice(), lp = laptop.page;
      const login = lp.getByRole('form', { name: 'Giriş yap' });
      await login.getByLabel('E-posta').fill(EMAIL);
      await login.getByLabel('Şifre', { exact: true }).fill(PASSWORD);
      await login.getByRole('button', { name: 'Devam' }).click();
      const codeForm = lp.getByRole('form', { name: 'Telefon kodu' });
      await codeForm.getByLabel('Telefon kodu').fill(await nextCode());
      await codeForm.getByRole('button', { name: 'Giriş yap' }).click();
      await lp.getByRole('region', { name: 'Uzaktan yönetim' }).or(lp.getByRole('region', { name: 'Bugünün satışı' })).first().waitFor({ timeout: 40000 });
      await pause(lp, 2000);
      await laptop.ctx.close(); }

    // ===== s2…s7: the café computer, one window =====
    await later(14, 40);
    w = await k.ownerWindow(); op = w.page;
    console.log('Kayıt: s2-cihazlar');
    { const rec = new Recorder(op, join(OUT, 's2-cihazlar'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'bell', op.locator('.topbar-bell'), { hold: 1600 });
      const note = op.getByText('Uzaktan yönetim girişi').first();
      await note.waitFor({ timeout: 20000 });
      rec.mark('notes');
      await rec.look(op, 'note', op.locator('article, li', { has: note }).first(), 3800);
      info.notification = await status(op.locator('article, li', { has: note }).first());
      await rec.tap(op, 'nav', nav(op, 'Ayarlar'), { hold: 1200 });
      await rec.tap(op, 'topic', topicTab(op, 'remote'), { hold: 1500 });
      const list = op.locator('ul.phone-list');
      await list.waitFor({ timeout: 20000 });
      await bring(op, list, 260, 1000);
      rec.mark('devices');
      await rec.look(op, 'list', list, 3600);
      info.devices = await status(list);
      const laptopRow = list.locator('li', { hasText: 'Windows' }).first();
      await rec.tap(op, 'kaldir', laptopRow.getByRole('button', { name: /cihazını kaldır/ }), { lead: 2400, hold: 1000 });
      rec.mark('confirm');
      await typeIn(op, rec, 'pw', laptopRow.getByLabel('Şifreniz'), PASSWORD, { delay: 60 });
      await rec.tap(op, 'evet', laptopRow.getByRole('button', { name: 'Evet, kaldır' }), { hold: 1500 });
      await list.locator('li', { hasText: 'Windows' }).first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
      await pause(op, 800);
      rec.mark('removed');
      await rec.look(op, 'listAfter', list, 2800);
      info.devicesAfter = await status(list);
      const admin = op.locator('.remote-admin-settings');
      await bring(op, admin, 200, 1000);
      rec.mark('admin');
      await rec.look(op, 'adminLook', admin, 3400);
      info.admin = await status(admin);
      await rec.stop(); }
    // Read (the bell was opened): the banner on Masalar does not come back on the next clips.
    await op.request.post(`${k.KAFE}/api/staff/notifications/read`, { data: {} });

    // Açık oturumlar as a café has them: this computer, the cashier and the waiter's Android tablet (the helpers' own sign-ins ended).
    await later(14, 44);
    { const ctx = await k.phoneContext(undefined, { userAgent: ANDROID_TABLET }), p = await ctx.newPage();
      await k.login(p, 'garson'); await ctx.close();
      const c = await k.as('kasiyer'); await c.close();
      type Row = { id: string; username: string; device: string; current: boolean; createdAt: string | null };
      const list = await (await op.request.get(`${k.KAFE}/api/staff/sessions`)).json() as Row[];
      const keep = new Set<string>([list.find(s => s.current)?.id, list.find(s => s.username === 'garson' && /Android/.test(s.device))?.id,
        [...list].filter(s => s.username === 'kasiyer').sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''))[0]?.id].filter((x): x is string => !!x));
      for (const s of list) if (!keep.has(s.id)) await op.request.post(`${k.KAFE}/api/staff/sessions/end`, { data: { id: s.id } });
      info.sessionsKept = list.filter(s => keep.has(s.id)).map(s => `${s.username} · ${s.device}`); }
    console.log('Kayıt: s3-oturumlar');
    { await nav(op, 'Masalar').click(); await pause(op, 1200);
      const rec = new Recorder(op, join(OUT, 's3-oturumlar'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', nav(op, 'Personel'), { hold: 1600 });
      const sessions = op.locator('.open-sessions');
      await sessions.locator('.session-row').first().waitFor({ timeout: 20000 });
      await bring(op, sessions, 140, 1200);
      rec.mark('sessions');
      await rec.look(op, 'list', sessions, 3800);
      info.sessions = await status(sessions);
      const tablet = sessions.locator('.session-row', { hasText: 'Android' }).first();
      await rec.tap(op, 'kapat', tablet.getByRole('button', { name: /oturumunu kapat/ }), { lead: 2400, hold: 1600 });
      rec.mark('closed');
      await rec.look(op, 'after', sessions, 3000);
      info.sessionsAfter = await status(sessions);
      await rec.stop(); }

    // ===== s4: the rail's "Kafe içi cihazlar" (a sample café Wi-Fi address, as a real install shows it) =====
    await w.ctx.route('**/api/desktop/status', async route => {
      const r = await route.fetch(), body = await r.json() as Record<string, unknown>;
      await route.fulfill({ response: r, json: { ...body, lan: true, addresses: [{ name: 'Wi-Fi', origin: 'http://192.168.1.20:3000' }] } });
    });
    await op.reload(); await pause(op, 2500);
    await op.mouse.click(640, 20); await pause(op, 600);
    console.log('Kayıt: s4-kafeici');
    { const rec = new Recorder(op, join(OUT, 's4-kafeici'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'rail', rail(op, /Kafe içi cihazlar/), { lead: 2200, hold: 1500 });
      const d = dialog(op);
      await d.locator('img.desktop-qr').waitFor({ timeout: 15000 }).catch(() => {});
      rec.mark('dialog');
      await rec.look(op, 'dialogLook', d, 4200);
      info.tablets = await status(d);
      await rec.tap(op, 'close', d.getByRole('button', { name: /Kapat/ }).first(), { lead: 500, hold: 900 });
      await rec.stop(); }
    await w.ctx.unroute('**/api/desktop/status');

    // ===== s5: Güvenlik ve yedek =====
    await later(14, 50);
    console.log('Kayıt: s5-yedek');
    { const rec = new Recorder(op, join(OUT, 's5-yedek'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', nav(op, 'Ayarlar'), { hold: 1200 });
      await rec.tap(op, 'topic', topicTab(op, 'security'), { hold: 1200 });
      await rec.tap(op, 'part', partTab(op, 'backup'), { hold: 1500 });
      const places = op.locator('.backup-places');
      await places.waitFor({ timeout: 20000 });
      await bring(op, places, 120, 900);
      rec.mark('places');
      await rec.box('path', places.locator('.backup-place').first().locator('small').first());
      await rec.look(op, 'placesLook', places, 4200);
      info.places = await status(places);
      const yedek = op.locator('.settings-card', { has: op.locator('.settings-backup, .settings-status') }).first();
      await bring(op, yedek, 120, 1000);
      rec.mark('yedekCard');
      await rec.look(op, 'yedekLook', yedek, 3400);
      info.yedek = await status(yedek);
      await rec.tap(op, 'rail', rail(op, /Yedekle/), { lead: 1800, hold: 1500 });
      const d = dialog(op);
      rec.mark('dialog');
      await rec.look(op, 'dialogLook', d, 2400);
      await rec.tap(op, 'simdi', d.getByRole('button', { name: 'Şimdi yedekle' }), { lead: 2200, hold: 600 });
      await d.getByText('Yedek alındı ve doğrulandı.').waitFor({ timeout: 300000 });
      await pause(op, 3000);
      rec.mark('done');
      await rec.look(op, 'doneLook', d, 3000);
      const kept = d.locator('details.backup-kept summary');
      if (await kept.isVisible().catch(() => false)) { await rec.tap(op, 'kept', kept, { hold: 1400 }); rec.mark('kept'); await rec.look(op, 'keptLook', d, 3200); }
      info.backupDialog = await status(d);
      await rec.tap(op, 'close', d.getByRole('button', { name: /Kapat/ }).first(), { lead: 500, hold: 900 });
      await rec.tap(op, 'guvenlik', rail(op, /Güvenlik/), { hold: 1500 });
      const g = dialog(op);
      rec.mark('security');
      await rec.look(op, 'securityLook', g, 3800);
      info.security = await status(g);
      const forgot = g.getByText('İşletme sahibi şifresini unuttum').first();
      if (await forgot.isVisible().catch(() => false)) { await bringIn(op, forgot, 40); rec.mark('forgot'); await rec.look(op, 'forgotLook', g, 3200); }
      await rec.tap(op, 'close2', g.getByRole('button', { name: /Kapat/ }).first(), { lead: 500, hold: 900 });
      await rec.stop(); }

    // ===== s6: Destek → Mola desteği: the remote support permission =====
    await later(14, 55);
    console.log('Kayıt: s6-destek');
    { const rec = new Recorder(op, join(OUT, 's6-destek'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', op.locator('.support-nav'), { hold: 1400 });
      await rec.tap(op, 'tab', op.getByRole('tab', { name: /Mola desteği/ }).or(op.getByRole('button', { name: /Mola desteği/ })).first(), { hold: 1500 });
      const sup = op.locator('.remote-support-card');
      await sup.waitFor({ timeout: 20000 });
      rec.mark('card');
      await rec.look(op, 'cardLook', sup, 3200);
      await rec.tap(op, 'toggle', sup.getByLabel('Mola ekibi bağlanabilsin'), { lead: 2400, hold: 1100 });
      rec.mark('ask');
      const form = sup.locator('form[aria-label="Uzaktan destek iznini aç"]');
      await typeIn(op, rec, 'pw', form.getByLabel('Şifreniz'), PASSWORD, { delay: 60 });
      await rec.tap(op, 'izin', form.getByRole('button', { name: 'İzni aç' }), { hold: 1500 });
      await sup.getByText(/Açık · Mola ekibi/).first().waitFor({ timeout: 20000 });
      rec.mark('on');
      await rec.look(op, 'onLook', sup, 2800);
      const rules = sup.locator('.remote-rules');
      await bring(op, rules, 200, 1000);
      rec.mark('rules');
      await rec.look(op, 'rulesLook', rules, 4200);
      info.support = await status(sup);
      await rec.stop(); }

    // ===== s7: Kasa ve giderler → Kasa ayarları → Kasa güvenliği =====
    console.log('Kayıt: s7-kasa');
    { const rec = new Recorder(op, join(OUT, 's7-kasa'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', nav(op, 'Kasa ve giderler'), { hold: 1400 });
      await rec.tap(op, 'tab', op.getByRole('tab', { name: /Kasa ayarları/ }).or(op.getByRole('button', { name: /Kasa ayarları/ })).first(), { hold: 1400 });
      await rec.tap(op, 'part', op.getByRole('tab', { name: /Kasa güvenliği/ }).or(op.getByRole('button', { name: /Kasa güvenliği/ })).first(), { hold: 1500 });
      const guard = op.locator('.cash-guard');
      await guard.waitFor({ timeout: 20000 });
      rec.mark('guard');
      await rec.look(op, 'guardLook', guard, 3600);
      const all = guard.getByRole('button', { name: 'Önerilenleri aç' });
      if (await all.isVisible().catch(() => false)) { await rec.tap(op, 'all', all, { hold: 1800 }); rec.mark('allOn'); await rec.look(op, 'allLook', guard, 3200); }
      info.guard = await status(guard);
      await rec.stop(); }
    await w.ctx.close(); await waiter.ctx.close();
    info.end = new Date(k.now()).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  } catch (e) {
    let i = 0;
    for (const b of [k.deskBrowser, k.phoneBrowser]) for (const c of b?.contexts() ?? []) for (const p of c.pages()) await p.screenshot({ path: join(BASE, `hata-${++i}.png`) }).catch(() => {});
    throw e;
  } finally {
    writeFileSync(join(OUT, 'bilgi.json'), JSON.stringify(info, null, 1));
    await k.close();
  }
}
/** The owner's next phone code (the authenticator app on the phone; set up on camera in u1). */
let nextCode: () => Promise<string> = () => Promise.reject(new Error('Telefon kodu henüz kurulmadı.'));
await main();
