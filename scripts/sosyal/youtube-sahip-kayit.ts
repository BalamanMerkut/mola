/*
 * YouTube E5 "İşletme sahibi: ilk gün" (training series, the owner's own screens on the first day after the installation):
 * recordings of the REAL app on the café computer's Mola window, signed in as the owner (edit: scripts/sosyal/youtube-sahip-kurgu.ts).
 * One run in story order on a fresh Mola Merkez + demo café ("Mola Örnek Kafe", shared parts: scripts/sosyal/kayit-ortak.ts) in
 * .local/sosyal/youtube/sahip/run-<zaman>/. The installation itself (download, activation, owner account, setup wizard, a
 * price, the waiter, the tablet, the printer, the first order) is video 06 "Kurulum"; this one is what comes after it.
 *
 * The run plays on the recording clock (kit({ saat })): the demo is made three evenings ago, its floor settled and its kasa
 * closed off camera, so today starts with an empty floor and no sales before it (the report's "Bugün" has nothing to compare
 * with, as on a first day). Off camera too: the Mola team's contact on Mola Merkez (destek@molayazilim.com.tr, the web site),
 * the kitchen printer of video 06 (switched off: no printer stands there), no POS rate yet, the kasa opened at 08:40.
 * From 08:45 the owner (Serkan Yıldız) on the café computer:
 *
 *   s1-kategori   Menü yönetimi → "Kategoriler ve sıra" → Tatlılar ↑ → "Sırayı kaydet".
 *   s2-urun       "Ürün ekle": Çikolatalı Pasta, Tatlılar, ₺150; "Fotoğraf seç" (a template photo) → "Fotoğrafı kullan".
 *   s3-secenek    "Müşteri seçenekleri" → "Servis tercihi ekle" (Dondurmalı +₺35) → "Kaydet ve yayınla"; the row's "Tükendi".
 *                 + q3-menu: the guest's menu (phone): the new tab order and the new product.
 *   s4-calisan    Personel → Çalışanlar → "Çalışan ekle": Selin Koç, Müdür, şifre → "Hesabı oluştur"; the cards; "Şifreyi yenile".
 *   s5-gorunum    Ayarlar → İşletme → Görünüm: ad, logo, renk paleti.
 *   s6-masa       Masalar ve QR → "Masa ekle" → Teras → "Yeni masayı oluştur"; "QR kodlarını yazdır" → A6 masa standı.
 *   s7-siparis    Sipariş ve mutfak → Sipariş ve onay (the settings of video 01).
 *   s8-kasa       Kasa ve giderler → Kasa ayarları → Kasiyer yetkileri (iade sınırı) → Kart ve yazar kasa → Yazar kasa yardımcısı on.
 *   s9-uzak       Ayarlar → Uzaktan erişim (the cards; its own video).
 *   s10-yardim    the top bar's "Yardım" → "Mola ekibine nasıl ulaşırım?" → the answer.
 *   s11-destek    Destek → Talepler (İletişim) → "Mola desteği".
 * Then the day (off camera, a waiter's tablet connected): 14 tables, 5 of them ordered by the guests' phones (QR), paid.
 *   s12-rapor     22:40, signed in again: Satış ve Raporlar → Bugün → "Detaylı göster" → Personel: "QR sipariş payı".
 *
 *   npx tsx scripts/sosyal/youtube-sahip-kayit.ts            (needs `npm run build`; ~10 minutes)
 *
 * No pointer: every click goes through Recorder.tap (box saved, a still lead-in the edit cuts). Mola window 1280×800 (2×), guest
 * phone 390×844 (3×). Ports: café 3772, Mola Merkez 3795. Every process is stopped at the end.
 * Output: .local/sosyal/youtube/sahip/kayit/<klip>/ (meta.json) and kayit/bilgi.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DESKTOP, NO_HINTS, PASSWORD, PHONE, ROOT, Recorder, choose, imagesOnScreen, istanbul, kit, pause, smoothScroll, typeIn, type Want } from './kayit-ortak';

const BASE = join(ROOT, '.local', 'sosyal', 'youtube', 'sahip');
const OUT = join(BASE, 'kayit');
const run = join(BASE, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const k = kit({ run, kafePort: 3772, merkezPort: 3795, saat: istanbul(-3, 22, 10) });
mkdirSync(OUT, { recursive: true });
const info: Record<string, unknown> = {};
const ist = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

// ---------- On the Mola window ----------
const dialog = (page: Page) => page.getByRole('dialog').last();
const nav = (page: Page, name: string) => page.locator('aside nav').getByRole('button', { name, exact: true });
const menuRow = (page: Page, name: string) => page.locator('.menu-row', { has: page.locator('h3', { hasText: new RegExp(`^${name}$`) }) }).first();
const topic = (page: Page, id: string) => page.locator(`[data-topic="${id}"]`).first();
const part = (page: Page, id: string) => page.locator(`[data-part="${id}"]`).first();
async function top(page: Page) { await page.evaluate('scrollTo({ top: 0, behavior: "smooth" })'); await pause(page, 900); }
/** Scrolls so that `target` stands `at` px below the top of the window. */
async function bring(page: Page, target: Locator, at: number, ms = 1000) {
  const y = await target.evaluate((e, a) => e.getBoundingClientRect().top - a, at);
  if (Math.abs(y) > 4) { await smoothScroll(page, Math.round(y), ms); await pause(page, 500); }
}
/** The owner on the café computer: signed in, sounds unlocked (a click on the header), Mola Yardım's hint off. */
async function ownerWindow() {
  const ctx = await k.desktopContext(); await ctx.addInitScript(NO_HINTS);
  const page = await ctx.newPage();
  await k.login(page, 'isletme');
  await page.goto(`${k.KAFE}/`); await pause(page, 1500);
  await page.mouse.click(900, 20); await pause(page, 600);
  const sound = page.getByText(/Ses kapalı/).first();
  if (await sound.isVisible().catch(() => false)) { await sound.click(); await pause(page, 600); }
  return { ctx, page };
}

async function main() {
  await k.launch();
  const desk = k.deskBrowser;
  try {
    await k.startServers();
    await k.prepareMenu(desk, { waiterApproval: false, changeSeconds: 0 });
    await k.calm(desk, true);
    await k.molaContact({ email: 'destek@molayazilim.com.tr', web: 'https://molayazilim.com.tr' });

    // ===== Three evenings ago (off camera): the floor settled, the kasa closed (count = expected), ₺500 left =====
    await k.settleAll();
    info.closedCash = await k.closeKasa();
    { const api = await k.ownerApi(desk);
      // The kitchen printer of video 06, switched off (no printer stands at this address): Ayarlar has no "Eksik" chip.
      await k.post(api.req, '/api/staff/printers', { printer: { name: 'Mutfak', enabled: false, connection: { type: 'network', host: '192.168.1.50', port: 9100 }, width: 80, charset: 'pc857', orders: true, bill: true } });
      // No POS rate yet (Kasa ayarları → Kart ve yazar kasa): the owner writes it when the bank's slip is at hand.
      const s = await k.state(api.req);
      await k.post(api.req, '/api/staff/settings', { sector: s.sector ?? 'cafe', paymentMode: s.paymentMode ?? 'after_service', cleaningEnabled: s.cleaningEnabled ?? false, waiterApproval: false, changeSeconds: 0, commissionBps: null });
      await api.close(); }
    console.log('Kapandı:', ist(k.now()));

    // ===== This morning: the cashier opens the kasa; the owner sits at the café computer =====
    await k.setClock(istanbul(0, 8, 40));
    await k.openKasa();
    await k.setClock(istanbul(0, 8, 45));
    // Last night's notes (the closing) already read: the bell is quiet on camera.
    await k.readNotifications();
    let { ctx, page } = await ownerWindow();
    info.morning = ist(k.now());

    // ===== s1: the order of the categories =====
    console.log('Kayıt: s1-kategori');
    let rec = new Recorder(page, join(OUT, 's1-kategori'), DESKTOP);
    await rec.start(); await pause(page, 1200);
    await rec.tap(page, 'nav', nav(page, 'Menü yönetimi'), { hold: 1600 });
    rec.mark('menu');
    await rec.tap(page, 'open', page.getByRole('button', { name: 'Kategoriler ve sıra' }), { hold: 1600 });
    rec.mark('modal');
    await rec.look(page, 'tabs', dialog(page).locator('.category-preview'), 2600);
    await rec.tap(page, 'up', dialog(page).getByRole('button', { name: 'Tatlılar yukarı' }), { lead: 1800, hold: 1600 });
    await rec.tap(page, 'save', dialog(page).getByRole('button', { name: 'Sırayı kaydet' }), { hold: 200 });
    await dialog(page).getByText('Sıra kaydedildi').first().waitFor({ timeout: 15000 });
    rec.mark('saved'); await pause(page, 2600);
    await rec.tap(page, 'close', dialog(page).getByRole('button', { name: /Kapat/ }).first(), { hold: 900 });
    await rec.stop();

    // ===== s2: a new product with its photo =====
    console.log('Kayıt: s2-urun');
    rec = new Recorder(page, join(OUT, 's2-urun'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'add', page.getByRole('button', { name: 'Ürün ekle' }), { hold: 1500 });
    rec.mark('editor');
    const ed = dialog(page);
    await typeIn(page, rec, 'name', ed.getByLabel('Ürün adı', { exact: true }), 'Çikolatalı Pasta', { delay: 90 });
    await choose(page, rec, 'category', ed.getByLabel('Kategori', { exact: true }), 'Tatlılar');
    await typeIn(page, rec, 'price', ed.getByLabel('Fiyat (TL)', { exact: true }), '150', { delay: 140 });
    await pause(page, 600);
    { const [chooser] = await Promise.all([page.waitForEvent('filechooser'), rec.tap(page, 'photo', ed.locator('label.photo-upload'), { lead: 1500, hold: 300 })]);
      await chooser.setFiles(join(ROOT, 'templates', 'gorseller', 'd-dilim-pasta.webp')); }
    await ed.locator('.crop-preview canvas').waitFor({ timeout: 15000 });
    rec.mark('crop'); await pause(page, 2400);
    await rec.tap(page, 'use', ed.getByRole('button', { name: 'Fotoğrafı kullan' }), { hold: 300 });
    await ed.locator('.photo-current img').first().waitFor({ timeout: 20000 });
    rec.mark('photo'); await pause(page, 2600);
    await rec.stop();

    // ===== s3: a choice for the guest, save; "Tükendi" =====
    console.log('Kayıt: s3-secenek');
    rec = new Recorder(page, join(OUT, 's3-secenek'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    const options = ed.locator('details.editor-disclosure').filter({ hasText: 'Müşteri seçenekleri' }).first();
    await rec.tap(page, 'options', options.locator('summary'), { hold: 1200 });
    await bring(page, options.locator('summary'), 150);
    await rec.tap(page, 'service', options.getByRole('button', { name: 'Servis tercihi ekle' }), { hold: 1400 });
    rec.mark('group');
    const extra = options.getByLabel('Ek ücret (TL)').nth(1);
    await rec.tap(page, 'extra', extra, { lead: 900, hold: 150 });
    await extra.press('Control+a'); await extra.pressSequentially('35', { delay: 160 }); await pause(page, 1200);
    rec.mark('typed');
    await rec.tap(page, 'save', ed.getByRole('button', { name: 'Kaydet ve yayınla' }), { hold: 200 });
    await ed.getByLabel('Ürün adı', { exact: true }).waitFor({ state: 'detached', timeout: 15000 });
    rec.mark('saved'); await pause(page, 1000);
    const search = page.getByPlaceholder('Ürün adı veya kodu');
    await typeIn(page, rec, 'search', search, 'Pasta', { delay: 110 });
    await pause(page, 1000);
    const row = menuRow(page, 'Çikolatalı Pasta');
    rec.mark('row');
    await rec.look(page, 'row', row, 2600);
    await rec.look(page, 'soldout', row.locator('label.availability'), 3600);
    await rec.stop();
    await search.fill(''); await pause(page, 500);

    // ===== q3: the guest's menu =====
    console.log('Kayıt: q3-menu');
    { const api = await k.ownerApi(desk), token = (await k.state(api.req)).tables.find(t => t.name === 'Masa 04')!.token; await api.close();
      const pctx = await k.phoneContext(), pp = await pctx.newPage();
      await k.openMenu(pp, token);
      const prec = new Recorder(pp, join(OUT, 'q3-menu'), PHONE);
      await prec.start(); await pause(pp, 1600);
      prec.mark('tabs');
      const target = pp.locator('.product-card', { hasText: 'Çikolatalı Pasta' }).first();
      const y = await target.evaluate(e => e.getBoundingClientRect().top - 300);
      await smoothScroll(pp, Math.round(y), 1600); await pause(pp, 600); await imagesOnScreen(pp);
      prec.mark('card');
      await prec.look(pp, 'card', target, 3600);
      await prec.stop();
      await pctx.close(); }

    // ===== s4: the staff accounts =====
    console.log('Kayıt: s4-calisan');
    await top(page);
    rec = new Recorder(page, join(OUT, 's4-calisan'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'nav', nav(page, 'Personel'), { hold: 1600 });
    rec.mark('staff');
    await rec.look(page, 'list', page.locator('.employee-list'), 3000);
    await rec.tap(page, 'add', page.getByRole('button', { name: 'Çalışan ekle' }), { hold: 1300 });
    rec.mark('form');
    const f = dialog(page);
    await typeIn(page, rec, 'name', f.getByLabel('Ad soyad'), 'Selin Koç', { delay: 100 });
    await pause(page, 700);
    await choose(page, rec, 'role', f.getByLabel('Görevi'), 'Müdür');
    rec.mark('manager'); await pause(page, 1400);
    await typeIn(page, rec, 'pass', f.getByLabel('Yeni şifre'), PASSWORD, { delay: 70 });
    await pause(page, 500);
    await rec.tap(page, 'create', f.getByRole('button', { name: 'Hesabı oluştur' }), { hold: 200 });
    await page.getByText('Çalışan hesabı oluşturuldu.').first().waitFor({ timeout: 15000 });
    rec.mark('created'); await pause(page, 1600);
    const card = page.locator('.employee-row', { hasText: 'Selin Koç' }).first();
    await bring(page, card, 140, 1200);
    rec.mark('card');
    await rec.look(page, 'card', card, 3400);
    const cashier = page.locator('.employee-row', { hasText: 'Zeynep Arslan' }).first();
    await bring(page, cashier, 120, 1200);
    await rec.look(page, 'roles', page.locator('.employee-list'), 4000);
    await rec.look(page, 'reset', cashier.getByRole('button', { name: 'Şifreyi yenile' }), 3600);
    await rec.stop();
    info.manager = 'Selin Koç';

    // ===== s5: Ayarlar → İşletme → Görünüm =====
    console.log('Kayıt: s5-gorunum');
    await top(page);
    rec = new Recorder(page, join(OUT, 's5-gorunum'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'nav', nav(page, 'Ayarlar'), { hold: 1400 });
    if ((await topic(page, 'business').getAttribute('aria-current')) !== 'page') await rec.tap(page, 'topic', topic(page, 'business'), { hold: 1200 });
    if ((await part(page, 'profile').getAttribute('aria-current')) !== 'page') await rec.tap(page, 'part', part(page, 'profile'), { hold: 1200 });
    rec.mark('page');
    await rec.look(page, 'topics', page.locator('.settings-topics').first(), 3000);
    const look = page.locator('.settings-card', { hasText: 'İşletme görünümü' }).first();
    await bring(page, look, 90, 1300);
    rec.mark('look');
    await rec.look(page, 'look', look, 3200);
    const palette = page.locator('.settings-card', { hasText: 'Renk paleti' }).first();
    await bring(page, palette, 90, 1300);
    rec.mark('palette');
    await rec.look(page, 'palette', palette, 3200);
    await rec.stop();

    // ===== s6: Masalar ve QR =====
    console.log('Kayıt: s6-masa');
    await top(page);
    rec = new Recorder(page, join(OUT, 's6-masa'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'topic', topic(page, 'tables'), { hold: 1200 });
    if ((await part(page, 'tableSetup').getAttribute('aria-current')) !== 'page') await rec.tap(page, 'part', part(page, 'tableSetup'), { hold: 1200 });
    rec.mark('page');
    await rec.tap(page, 'add', page.locator('.settings-actions').getByRole('button', { name: 'Masa ekle' }), { lead: 1600, hold: 1400 });
    rec.mark('modal');
    const m = dialog(page);
    await rec.tap(page, 'area', m.locator('.area-choice', { hasText: 'Teras' }).first(), { hold: 1000 });
    await rec.tap(page, 'create', m.getByRole('button', { name: 'Yeni masayı oluştur' }), { hold: 200 });
    await m.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    rec.mark('added'); await pause(page, 1200);
    const teras = page.locator('.layout-tables li', { hasText: 'Masa 17' }).first();
    await bring(page, teras, 430, 1400);
    rec.mark('new');
    await rec.look(page, 'new', teras, 3000);
    await top(page);
    await rec.tap(page, 'print', part(page, 'qrPrint'), { hold: 1400 });
    rec.mark('print');
    await rec.tap(page, 'a6', page.getByRole('button', { name: /A6 masa standı/ }).first(), { lead: 1400, hold: 2000 });
    await rec.look(page, 'go', page.getByRole('button', { name: 'Yazdır', exact: true }).first(), 3000);
    await rec.stop();

    // ===== s7: Sipariş ve mutfak (video 01) =====
    console.log('Kayıt: s7-siparis');
    rec = new Recorder(page, join(OUT, 's7-siparis'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'topic', topic(page, 'orders'), { hold: 1400 });
    if ((await part(page, 'orders').getAttribute('aria-current')) !== 'page') await rec.tap(page, 'part', part(page, 'orders'), { hold: 1200 });
    rec.mark('page');
    await rec.look(page, 'pay', page.locator('.settings-card', { hasText: 'Sipariş ve ödeme' }).first(), 3600);
    const qrCard = page.locator('.settings-card', { hasText: 'QR siparişlerinin onayı' }).first();
    await bring(page, qrCard, 260, 1200);
    await rec.look(page, 'qr', qrCard, 3600);
    await rec.stop();

    // ===== s8: Kasa ayarları =====
    console.log('Kayıt: s8-kasa');
    await top(page);
    rec = new Recorder(page, join(OUT, 's8-kasa'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'nav', nav(page, 'Kasa ve giderler'), { hold: 1400 });
    await rec.tap(page, 'tab', page.locator('[data-home-tab="settings"]').first(), { hold: 1400 });
    if ((await part(page, 'limits').getAttribute('aria-current')) !== 'page') await rec.tap(page, 'limits', part(page, 'limits'), { hold: 1400 });
    rec.mark('limits');
    await rec.look(page, 'refund', page.locator('.settings-row', { hasText: 'Kasiyerin yapabileceği en yüksek iade' }).locator('input').first(), 4200);
    await rec.tap(page, 'card', part(page, 'card'), { hold: 1400 });
    rec.mark('fiscal');
    const fiscal = page.locator('.settings-card', { hasText: 'Yazar kasa yardımcısı' }).first();
    await rec.look(page, 'lead', fiscal, 2800);
    const toggle = fiscal.locator('.settings-row').first().locator('.settings-toggle input');
    await rec.tap(page, 'toggle', toggle, { lead: 2000, hold: 300 });
    await fiscal.getByText(/^Açık: her ödemeden sonra/).first().waitFor({ timeout: 15000 });
    rec.mark('on'); await pause(page, 3000);
    await rec.stop();

    // ===== s9: Uzaktan erişim =====
    console.log('Kayıt: s9-uzak');
    await top(page);
    rec = new Recorder(page, join(OUT, 's9-uzak'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'nav', nav(page, 'Ayarlar'), { hold: 1400 });
    await rec.tap(page, 'topic', topic(page, 'remote'), { hold: 1600 });
    rec.mark('page');
    await rec.look(page, 'cards', page.locator('.settings-page-body').first(), 3200);
    const last = page.locator('.settings-card', { hasText: 'Uzaktan yönetim' }).last();
    await bring(page, last, 330, 1600);
    rec.mark('down'); await pause(page, 2600);
    await rec.stop();

    // ===== s10: Mola Yardım =====
    console.log('Kayıt: s10-yardim');
    rec = new Recorder(page, join(OUT, 's10-yardim'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'help', page.getByRole('button', { name: 'Mola Yardım' }), { lead: 1800, hold: 1600 });
    rec.mark('panel');
    const sheet = page.locator('dialog.help-sheet');
    await typeIn(page, rec, 'ask', sheet.getByLabel('Sorunuzu yazın'), 'Mola ekibine nasıl ulaşırım', { delay: 85 });
    await pause(page, 500);
    await page.keyboard.press('Enter');
    const answer = sheet.locator('.help-answer').last();
    await answer.waitFor({ timeout: 15000 });
    rec.mark('answer'); await pause(page, 1200);
    await rec.look(page, 'answer', answer, 5200);
    await rec.tap(page, 'close', sheet.getByRole('button', { name: 'Yardımı kapat' }), { hold: 900 });
    await rec.stop();
    info.helpAnswer = await answer.innerText().catch(() => '');

    // ===== s11: Destek =====
    console.log('Kayıt: s11-destek');
    rec = new Recorder(page, join(OUT, 's11-destek'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'nav', page.locator('.support-nav'), { hold: 1800 });
    rec.mark('page');
    const contact = page.locator('.support-info').first();
    await contact.waitFor({ timeout: 15000 });
    await rec.look(page, 'tickets', page.locator('.support-tickets').first(), 3000);
    await bring(page, contact, 200, 1200);
    rec.mark('contact');
    await rec.look(page, 'contact', contact.locator('.mola-contact'), 3600);
    await top(page);
    await rec.tap(page, 'remote', page.locator('#support-tab-remote'), { hold: 1600 });
    rec.mark('remote');
    await rec.look(page, 'permission', page.locator('.remote-support-card').first(), 4200);
    await rec.stop();
    info.contact = await contact.innerText().catch(() => '');
    await ctx.close();

    // ===== The day (off camera): a waiter's tablet connected, the tables served and paid =====
    const waiter = await k.staffScreen('garson', 'tablet');
    const day: { table: string; at: number; lines: Want[]; method: 'cash' | 'card'; qr?: boolean }[] = [
      { table: 'Masa 02', at: 10 * 60 + 20, lines: [['Türk Kahvesi', 2], ['Demleme Çay', 1]], method: 'cash' },
      { table: 'Masa 05', at: 11 * 60, lines: [['Caffè Latte', 1], ['Çikolatalı Pasta', 1]], method: 'card', qr: true },
      { table: 'Masa 07', at: 11 * 60 + 40, lines: [['Americano', 2], ['San Sebastian', 1]], method: 'card' },
      { table: 'Masa 10', at: 12 * 60 + 25, lines: [['Ev Yapımı Limonata', 2]], method: 'card', qr: true },
      { table: 'Masa 03', at: 13 * 60 + 15, lines: [['Ayran', 2], ['Künefe', 1]], method: 'cash' },
      { table: 'Masa 12', at: 13 * 60 + 58, lines: [['Demleme Çay', 3], ['Fıstıklı Baklava', 1]], method: 'cash' },
      { table: 'Masa 14', at: 14 * 60 + 35, lines: [['Caffè Latte', 2], ['Çikolatalı Brownie', 1]], method: 'card', qr: true },
      { table: 'Masa 08', at: 15 * 60 + 20, lines: [['Türk Kahvesi', 2], ['Kazandibi', 1]], method: 'card' },
      { table: 'Masa 17', at: 16 * 60 + 10, lines: [['Ihlamur', 1], ['Çikolatalı Pasta', 2]], method: 'cash' },
      { table: 'Masa 06', at: 17 * 60 + 15, lines: [['Americano', 1], ['Profiterol', 1]], method: 'card', qr: true },
      { table: 'Masa 11', at: 18 * 60 + 30, lines: [['Demleme Çay', 3], ['Fırın Sütlaç', 2]], method: 'cash' },
      { table: 'Masa 04', at: 19 * 60 + 40, lines: [['Ev Yapımı Limonata', 1], ['San Sebastian', 1]], method: 'card' },
      { table: 'Masa 15', at: 20 * 60 + 50, lines: [['Caffè Latte', 1], ['Künefe', 1]], method: 'card', qr: true },
      { table: 'Masa 09', at: 22 * 60, lines: [['Türk Kahvesi', 3], ['Çikolatalı Pasta', 1]], method: 'card' },
    ];
    await k.serveDay(day);
    await waiter.ctx.close();
    info.day = day.length;

    // ===== s12: the first day's report (22:40) =====
    await k.setClock(istanbul(0, 22, 40));
    await k.readNotifications();
    ({ ctx, page } = await ownerWindow());
    console.log('Kayıt: s12-rapor');
    rec = new Recorder(page, join(OUT, 's12-rapor'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'nav', nav(page, 'Satış ve Raporlar'), { hold: 1800 });
    rec.mark('reports');
    const sentence = page.locator('.simple-sentence').first();
    await sentence.waitFor({ timeout: 15000 }); await pause(page, 600);
    await rec.look(page, 'sentence', sentence, 4200);
    await rec.look(page, 'grid', page.locator('.simple-grid').first(), 3600);
    await rec.tap(page, 'detail', page.getByRole('button', { name: /Detaylı göster/ }).first(), { hold: 1400 });
    await rec.tap(page, 'people', page.locator('[data-report-group="people"]').first(), { hold: 1600 });
    const donut = page.locator('.self-service-report').first();
    await donut.waitFor({ timeout: 15000 });
    await bring(page, donut, 150, 1200);
    rec.mark('donut');
    await rec.look(page, 'donut', donut.locator('.employee-donut'), 5600);
    await rec.stop();
    info.sentence = await sentence.innerText().catch(() => '');
    info.donut = await donut.innerText().catch(() => '');
    await ctx.close();
  } catch (e) {
    for (const c of k.deskBrowser.contexts()) for (const [i, p] of c.pages().entries()) await p.screenshot({ path: join(BASE, `hata-${i}.png`) }).catch(() => {});
    throw e;
  } finally {
    writeFileSync(join(OUT, 'bilgi.json'), JSON.stringify(info, null, 1));
    await k.close();
  }
}
await main();
