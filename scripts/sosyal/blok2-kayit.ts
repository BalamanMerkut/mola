/*
 * Instagram blok 2 (mutfak, kampanya, telefondan yönetim): recordings of the REAL app for the three videos and the screenshots
 * of the three images (edit: scripts/sosyal/blok2-kurgu.ts). Never real data: one run on a fresh Mola Merkez + demo café
 * ("Mola Örnek Kafe", shared parts: scripts/sosyal/kayit-ortak.ts) in .local/sosyal/blok2/run-<zaman>/.
 *
 * The run plays on the recording clock (kit({ saat, gun })): the demo café is made with 30 days of history up to yesterday
 * evening (Raporlar → 30 gün has the guests' QR orders), its floor settled and its kasa closed off camera; this morning the kasa
 * is opened and the morning's tables (some of them ordered from the guests' phones) are served and paid off camera. Then:
 *
 *   mutfak-tablet  12:05 the waiter's tablet (1180×820): Masa 05's basket → "Siparişi gönder"; later (Masalar) the note
 *   mutfak-ekran   "Masa 05 · #n hazır" → "Servise hazır". Recorded together with the kitchen display (1280×800, Mutfak
 *                  modu): the card arrives → "Hazırlamaya başla" → "Hazır olarak işaretle".
 *   ekran          12:25 stills: the counter's Masalar on a tablet (kasiyer, 1180×820), the guest's Türk Kahvesi window (phone).
 *   kampanya-sahip 13:00 the owner's phone (the café's own screens, 390×844): Menü yönetimi → Kampanyalar → "Kampanya ekle"
 *                  → Kampanya türü "X al Y öde" (2 al 1 öde) → "Menüden seç" → Caffè Latte → "Seçimi tamamla" → "Kampanyayı kaydet".
 *   kampanya-musteri  a guest's phone at Masa 10: Kahveler (Caffè Latte "2 al 1 öde") → 2 Caffè Latte → the basket with the
 *                  campaign discount.
 *   rapor          13:30 still: Satış ve Raporlar → 30 gün → Detaylı göster → Personel: "Müşterilerin kendi verdiği siparişler".
 *   uzak-telefon   14:10 İşletmemi yönet on the owner's phone (set up and signed in off camera, so no code is ever on screen):
 *                  Bugünün satışı → "İşletmeyi yönet" → Daha fazla → Menü yönetimi → San Sebastian → Fiyat → "Kaydet ve yayınla".
 *   uzak-musteri   a guest's phone at Masa 12: Tatlılar with the new price.
 *
 *   npx tsx scripts/sosyal/blok2-kayit.ts        (needs `npm run build`; ~12 minutes)
 *   npx tsx scripts/sosyal/blok2-kayit.ts ekran  only these (mutfak ekran kampanya rapor uzak; the setup runs anyway)
 *   BLOK2_HIZLI=1 …                             a quick rehearsal (5 days of history)
 *
 * No pointer: every tap goes through Recorder.tap (box saved, a still lead-in the edit cuts; the edit draws a soft ring).
 * Ports: café 3730, Mola Merkez 3731. Every process is stopped at the end.
 * Output: .local/sosyal/blok2/kayit/<klip>/ (meta.json), kayit/ekran/*.png and kayit/bilgi.json (the figures on screen).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { NO_HINTS, PHONE, ROOT, Recorder, bring, choose, dialog, imagesOnScreen, istanbul, kit, nav, pause, retype, smoothScroll, tableCard, type Want } from './kayit-ortak';

const BASE = join(ROOT, '.local', 'sosyal', 'blok2');
const OUT = join(BASE, 'kayit');
const SHOTS = join(OUT, 'ekran');
const FAST = !!process.env.BLOK2_HIZLI;
const run = join(BASE, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const k = kit({ run, kafePort: 3730, merkezPort: 3731, saat: istanbul(-1, 22, 10), gun: FAST ? 5 : 30 });
mkdirSync(SHOTS, { recursive: true });
const info: Record<string, unknown> = {};
/** The demo owner's (Serkan Yıldız) e-mail: only the run's fake SMTP server ever sees it. */
const EMAIL = 'serkan@ornekkafe.com';
/** The product of the campaign (post 6) and the product whose price the owner changes from the phone (post 8). */
const DEAL = 'Caffè Latte', PRICED = 'Fıstıklı Baklava';
/** The waiter's tablet and the kitchen's screen: a 1024×768 tablet (2×), so their text stays readable in a 1080 px wide post. */
const IPAD = { width: 1024, height: 768, scale: 2 };

/** This morning's tables (off camera): ordered at their minute (some by the guest's phone), made, served, paid 35 minutes later. */
const MORNING: { table: string; at: number; lines: Want[]; method: 'cash' | 'card'; qr?: boolean }[] = [
  { table: 'Masa 02', at: 8 * 60 + 25, lines: [['Türk Kahvesi', 3], ['Demleme Çay', 3], ['Fırın Sütlaç', 2], ['Künefe', 1]], method: 'cash' },
  { table: 'Masa 06', at: 9 * 60 + 1, lines: [['Caffè Latte', 3], ['San Sebastian', 2], ['Americano', 1]], method: 'card', qr: true },
  { table: 'Masa 09', at: 9 * 60 + 37, lines: [['Americano', 2], ['Künefe', 2], ['Ayran', 2], ['Profiterol', 1]], method: 'card' },
  { table: 'Masa 03', at: 10 * 60 + 13, lines: [['Türk Kahvesi', 4], ['Fıstıklı Baklava', 2], ['Kazandibi', 1]], method: 'card', qr: true },
  { table: 'Masa 11', at: 10 * 60 + 49, lines: [['Demleme Çay', 3], ['Çikolatalı Brownie', 2], ['Caffè Latte', 2], ['San Sebastian', 1]], method: 'cash' },
  { table: 'Masa 12', at: 11 * 60 + 25, lines: [['Ayran', 3], ['Künefe', 2], ['Americano', 2]], method: 'card' },
];

const kcard = (page: Page, table: string) => page.locator('.kitchen-card', { has: page.locator('h3', { hasText: new RegExp(`^${table}$`) }) }).first();
const status = async (page: Page, sel: string) => (await page.locator(sel).first().innerText({ timeout: 5000 }).catch(() => '')).replace(/\s+/g, ' ').trim();
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const want = (name: string) => !only.length || only.includes(name);

async function main() {
  await k.launch();
  const desk = k.deskBrowser;
  try {
    await k.startServers();
    await k.prepareMenu(desk, { waiterApproval: false, changeSeconds: 0 });
    await k.calm(desk, true);
    await k.settleAll();
    await k.closeKasa();
    const owner = async <T>(fn: (req: Awaited<ReturnType<typeof k.ownerApi>>['req']) => Promise<T>) => { const api = await k.ownerApi(desk); try { return await fn(api.req); } finally { await api.close(); } };
    const get = <T>(path: string) => owner(async req => (await (await req.get(`${k.KAFE}${path}`)).json()) as T);
    const tokenOf = (table: string) => owner(async req => (await k.state(req)).tables.find(t => t.name === table)!.token);
    // The demo's campaigns on products kept off this menu (no photo) are deleted off camera: Kampanyalar shows what guests can see.
    { const list = await get<{ campaigns: { id: string; name: string; productIds: string[] }[]; revision: number }>('/api/staff/campaigns');
      const shown = new Set((await get<{ products: { id: string; published?: boolean }[] }>('/api/staff/state')).products.filter(p => p.published !== false).map(p => p.id));
      let revision = list.revision;
      for (const c of list.campaigns.filter(c => c.productIds.length && !c.productIds.some(id => shown.has(id)))) {
        try { const r = await owner(req => k.post(req, '/api/staff/catalog/remove', { kind: 'campaign', id: c.id, revision, requestId: randomUUID() })) as { revision?: number }; revision = r.revision ?? (await get<{ revision: number }>('/api/staff/campaigns')).revision; }
        catch { revision = (await get<{ revision: number }>('/api/staff/campaigns')).revision; }
      } }
    info.prices = Object.fromEntries((await get<{ products: { name: string; price: number; published?: boolean }[] }>('/api/staff/state')).products.filter(p => p.published !== false).map(p => [p.name, p.price / 100]));

    // ===== This morning (off camera): the kasa opened, the waiter's tablet on (QR orders need a staff screen), the tables =====
    await k.setClock(istanbul(0, 8, 20));
    await k.openKasa(50000);
    let tablet = await k.staffScreen('garson', 'tablet');
    await k.serveDay(FAST ? MORNING.slice(0, 2) : MORNING);
    await k.readNotifications();

    // ===== Post 4: the waiter's tablet and the kitchen display =====
    await k.setClock(istanbul(0, 12, 5));
    await tablet.ctx.close(); tablet = await k.staffScreen('garson', 'tablet', false, IPAD);
    const tp = tablet.page;
    if (want('mutfak')) {
      const kctx = await k.tabletContext(IPAD); await kctx.addInitScript(NO_HINTS);
      const kp = await kctx.newPage();
      await k.login(kp, 'mutfak'); await kp.goto(`${k.KAFE}/`);
      await kp.locator('.kitchen-board').waitFor({ timeout: 20000 }); await pause(kp, 1500);
      // The basket of Masa 05 made ready off camera: 2 Türk Kahvesi (orta), 1 Fıstıklı Baklava.
      await tp.evaluate('scrollTo(0, 0)');
      await tableCard(tp, 'Masa 05').click(); await pause(tp, 1200);
      await dialog(tp).getByRole('button', { name: /Sipariş ekle/ }).click(); await pause(tp, 1500);
      await tp.locator('.staff-card', { hasText: 'Türk Kahvesi' }).first().click(); await pause(tp, 900);
      await dialog(tp).getByText(/^Orta$/).first().click(); await pause(tp, 300);
      await dialog(tp).getByRole('button', { name: 'Adedi artır' }).click(); await pause(tp, 300);
      await dialog(tp).getByRole('button', { name: /Sepete ekle/ }).click(); await pause(tp, 900);
      await tp.getByRole('button', { name: /^Fıstıklı Baklava · bir adet ekle/ }).click(); await pause(tp, 900);
      await tp.locator('.staff-basket-open').click(); await pause(tp, 1600);
      console.log('Kayıt: mutfak-tablet / mutfak-ekran');
      const recT = new Recorder(tp, join(OUT, 'mutfak-tablet'), IPAD), recK = new Recorder(kp, join(OUT, 'mutfak-ekran'), IPAD);
      await recT.start(); await recK.start(); await pause(tp, 1200);
      await recT.tap(tp, 'send', dialog(tp).getByRole('button', { name: 'Siparişi gönder', exact: true }), { lead: 1200, hold: 200 });
      await tp.getByText(/mutfağa gönderildi/).first().waitFor({ timeout: 15000 }).catch(() => {});
      recT.mark('sent');
      await kcard(kp, 'Masa 05').waitFor({ timeout: 20000 });
      recK.mark('ticket');
      // Off focus (the edit shows the kitchen now): the tablet back on Masalar.
      await pause(tp, 1600);
      await nav(tp, 'Masalar').click(); await pause(tp, 600); await tp.evaluate('scrollTo(0, 0)');
      await pause(kp, 1200);
      await recK.tap(kp, 'start', kcard(kp, 'Masa 05').getByRole('button', { name: /Hazırlamaya başla/ }), { lead: 1200, hold: 300 });
      recK.mark('started');
      await pause(kp, 2000);
      await recK.tap(kp, 'ready', kcard(kp, 'Masa 05').getByRole('button', { name: /Hazır olarak işaretle/ }), { lead: 1200, hold: 300 });
      recK.mark('readyDone');
      const toast = tp.locator('.toast').first();
      await toast.waitFor({ timeout: 15000 });
      recT.mark('toast'); await recT.box('toast', toast);
      info.toast = await toast.innerText();
      await recT.box('card', tableCard(tp, 'Masa 05'));
      info.cardReady = (await tableCard(tp, 'Masa 05').innerText()).replace(/\s+/g, ' ');
      await pause(tp, 2600);
      await recT.tap(tp, 'readyNav', nav(tp, 'Servise hazır'), { lead: 900, hold: 300 });
      await tp.locator('.ready-orders').waitFor({ timeout: 15000 });
      await pause(tp, 500);
      recT.mark('readyList');
      info.readyList = await status(tp, '.ready-orders');
      await pause(tp, 3400);
      await recK.stop(); await recT.stop();
      await kctx.close();
      await nav(tp, 'Masalar').click(); await pause(tp, 800);
    }
    // Off camera: Masa 05 served.
    await k.advance(['preparing', 'ready', 'served']);

    // ===== Post 7 and post 5: stills =====
    await k.setClock(istanbul(0, 12, 20));
    if (want('ekran')) {
      // The lunch floor: a new order, one being made, one ready, two served; the others empty.
      await k.order('Masa 01', [['Demleme Çay', 2], ['Fırın Sütlaç', 1]]);
      await k.order('Masa 04', [['Americano', 1], ['Künefe', 1]]); await k.advance(['preparing'], 'Masa 04');
      await k.order('Masa 07', [['Ayran', 2], ['Çikolatalı Brownie', 1]]); await k.advance(['preparing', 'ready'], 'Masa 07');
      await k.order('Masa 13', [['Türk Kahvesi', 2]]); await k.advance(['preparing', 'ready', 'served'], 'Masa 13');
      await k.setClock(istanbul(0, 12, 25));
      const counter = await k.staffScreen('kasiyer', 'tablet');
      await pause(counter.page, 1500);
      await counter.page.screenshot({ path: join(SHOTS, 'masalar-tablet.png') });
      info.floor = await status(counter.page, '.floor-head');
      await counter.ctx.close();
      // The same floor on the waiter's phone.
      const wphone = await k.staffScreen('garson', 'phone');
      await wphone.page.evaluate('scrollTo(0, 0)'); await pause(wphone.page, 1200);
      await wphone.page.screenshot({ path: join(SHOTS, 'masalar-telefon.png') });
      await wphone.ctx.close();
      const ow = await k.ownerWindow();
      await ow.page.screenshot({ path: join(SHOTS, 'masalar-masaustu.png') });
      await ow.ctx.close();
      // The guest's Türk Kahvesi (phone, 3×).
      const ctx = await k.phoneContext(); await ctx.addInitScript('window.__molaNoFinger = true');
      const g = await ctx.newPage();
      await k.openMenu(g, await tokenOf('Masa 02'));
      await g.screenshot({ path: join(SHOTS, 'menu-ust.png') });
      await g.locator('.product-card', { hasText: 'Türk Kahvesi' }).first().click(); await pause(g, 1400);
      await imagesOnScreen(g);
      await g.screenshot({ path: join(SHOTS, 'turk-kahvesi.png') });
      info.turk = (await dialog(g).innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ');
      await ctx.close();
      await k.advance(['preparing', 'ready', 'served']);
    }

    // ===== Post 6: a "2 al 1 öde" campaign from the owner's phone, then the guest's menu =====
    await k.setClock(istanbul(0, 13, 0));
    if (want('kampanya')) {
      const octx = await k.phoneContext(); await octx.addInitScript('window.__molaNoFinger = true'); await octx.addInitScript(NO_HINTS);
      const op = await octx.newPage();
      await k.login(op, 'isletme'); await op.goto(`${k.KAFE}/`); await pause(op, 1500);
      await op.locator('.bottom-nav').getByRole('button', { name: /Daha fazla/ }).click(); await pause(op, 800);
      await op.locator('.bottom-sheet').getByRole('button', { name: /Menü yönetimi/ }).click(); await pause(op, 1200);
      await op.locator('[data-home-tab="campaigns"]').click(); await pause(op, 1500);
      await op.evaluate('scrollTo(0, 0)'); await pause(op, 600);
      console.log('Kayıt: kampanya-sahip');
      const rec = new Recorder(op, join(OUT, 'kampanya-sahip'), PHONE);
      await rec.start(); await pause(op, 1300);
      await rec.tap(op, 'add', op.getByRole('button', { name: 'Kampanya ekle' }), { hold: 1300 });
      const d = dialog(op);
      await d.locator('.campaign-editor-form').waitFor({ timeout: 20000 });
      rec.mark('form');
      await choose(op, rec, 'kind', d.getByLabel(/^Kampanya türü/), 'X al Y öde');
      rec.mark('kind');
      info.example = await status(op, '.campaign-editor-form .campaign-schedule-summary');
      await pause(op, 1200);
      await rec.tap(op, 'pick', d.getByRole('button', { name: /Menüden seç/ }), { hold: 1300 });
      rec.mark('picker');
      await rec.tap(op, 'product', dialog(op).locator('.product-card', { hasText: DEAL }).first(), { lead: 1000, hold: 900 });
      await rec.tap(op, 'done', dialog(op).getByRole('button', { name: /Seçimi tamamla/ }), { lead: 900, hold: 1200 });
      rec.mark('named');
      info.name = await d.getByLabel(/^Kampanya adı/).inputValue();
      await pause(op, 1600);
      await rec.tap(op, 'save', d.getByRole('button', { name: 'Kampanyayı kaydet' }), { lead: 1000, hold: 300 });
      await op.locator('.campaign-editor-dialog').waitFor({ state: 'detached', timeout: 20000 });
      await pause(op, 700);
      rec.mark('saved');
      const card = op.locator('article.campaign-card', { hasText: info.name as string }).first();
      await bring(op, card, 150, 1100);
      rec.mark('card');
      await rec.look(op, 'cardLook', card, 3000);
      info.card = (await card.innerText()).replace(/\s+/g, ' ');
      await rec.stop();
      await octx.close();

      const gctx = await k.phoneContext(); await gctx.addInitScript('window.__molaNoFinger = true');
      const g = await gctx.newPage();
      await k.openMenu(g, await tokenOf('Masa 10'));
      console.log('Kayıt: kampanya-musteri');
      const recG = new Recorder(g, join(OUT, 'kampanya-musteri'), PHONE);
      await recG.start(); await pause(g, 1200);
      await recG.tap(g, 'kahveler', g.locator('.category-tabs').getByRole('button', { name: 'Kahveler' }), { lead: 900, hold: 900 });
      await bring(g, g.locator('.product-card', { hasText: DEAL }).first(), 150, 1000); await imagesOnScreen(g);
      recG.mark('grid');
      await recG.look(g, 'badge', g.locator('.product-card', { hasText: DEAL }).first(), 2400);
      info.guestCard = (await g.locator('.product-card', { hasText: DEAL }).first().innerText()).replace(/\s+/g, ' ');
      await recG.tap(g, 'product', g.locator('.product-card', { hasText: DEAL }).first(), { lead: 700, hold: 1300 });
      await recG.tap(g, 'more', dialog(g).getByRole('button', { name: 'Adedi artır' }), { lead: 900, hold: 800 });
      await recG.tap(g, 'add', g.getByRole('button', { name: /Sepete ekle/ }), { lead: 800, hold: 1000 });
      await recG.tap(g, 'cart', g.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }), { lead: 800, hold: 1300 });
      recG.mark('basket');
      info.basket = (await dialog(g).innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ');
      await recG.look(g, 'basketLook', dialog(g), 3800);
      await recG.stop();
      await gctx.close();
    }

    // Off camera: the lunch tables paid.
    await k.setClock(istanbul(0, 13, 25));
    await k.settleAll();

    // ===== Post 9: the QR share of the last 30 days (still) =====
    await k.setClock(istanbul(0, 13, 30));
    if (want('rapor')) {
      const ow = await k.ownerWindow(), op = ow.page;
      await nav(op, 'Satış ve Raporlar').click(); await pause(op, 1500);
      await op.locator('.period-pills').getByRole('button', { name: '30 gün', exact: true }).first().click(); await pause(op, 1500);
      await op.locator('.simple-detail-btn').click();
      await op.locator('.kpi-row').first().waitFor({ timeout: 20000 }); await pause(op, 800);
      await op.locator('[data-report-group="people"]').click();
      const qr = op.locator('.self-service-report');
      await qr.waitFor({ timeout: 20000 }); await qr.scrollIntoViewIfNeeded(); await pause(op, 1200);
      await qr.screenshot({ path: join(SHOTS, 'qr-payi.png') });
      await op.screenshot({ path: join(SHOTS, 'qr-payi-sayfa.png') });
      info.qr = (await qr.innerText()).replace(/\s+/g, ' ');
      await ow.ctx.close();
    }

    // ===== Post 8: İşletmemi yönet on the owner's phone (set up and signed in off camera) =====
    if (want('uzak')) {
      await k.setClock(istanbul(0, 13, 50));
      const remote = await k.ownerRemote({ email: EMAIL, admin: true });
      await k.setClock(istanbul(0, 14, 10));
      const phone = await k.ownerPhone(remote, EMAIL), tel = phone.page;
      await tel.evaluate(NO_HINTS);
      // The sign-in's notification closed off camera, then back on the report.
      await tel.getByRole('button', { name: /^İşletmeyi yönet/ }).first().click();
      const bar = tel.getByRole('region', { name: 'Uzaktan yönetim' });
      await bar.waitFor({ timeout: 30000 }); await pause(tel, 2500);
      for (let i = 0; i < 3; i++) { const x = tel.getByRole('button', { name: 'Bildirim uyarısını kapat' }).first(); if (!(await x.isVisible().catch(() => false))) break; await x.click(); await pause(tel, 700); }
      await k.readNotifications();
      await bar.getByRole('button', { name: 'Raporlar' }).click();
      const hero = tel.getByRole('region', { name: 'Bugünün satışı' });
      await hero.waitFor({ timeout: 30000 }); await pause(tel, 1500);
      await tel.evaluate('scrollTo(0, 0)'); await pause(tel, 800);
      console.log('Kayıt: uzak-telefon');
      const rec = new Recorder(tel, join(OUT, 'uzak-telefon'), PHONE);
      await rec.start(); await pause(tel, 1400);
      rec.mark('report');
      await rec.look(tel, 'hero', hero, 2600);
      info.report = await status(tel, '.rp-page');
      await smoothScroll(tel, 560, 1300); await pause(tel, 400);
      rec.mark('down');
      await pause(tel, 2200);
      await smoothScroll(tel, -560, 1000); await pause(tel, 500);
      rec.mark('up');
      await rec.tap(tel, 'yonet', tel.getByRole('button', { name: /^İşletmeyi yönet/ }).first(), { lead: 900, hold: 1200 });
      await bar.waitFor({ timeout: 30000 }); await pause(tel, 1300);
      rec.mark('screens');
      for (let i = 0; i < 3; i++) { const x = tel.getByRole('button', { name: 'Bildirim uyarısını kapat' }).first(); if (!(await x.isVisible().catch(() => false))) break; await x.click(); await pause(tel, 500); }
      await rec.tap(tel, 'more', tel.locator('.bottom-nav').getByRole('button', { name: /Daha fazla/ }), { lead: 800, hold: 1000 });
      await rec.tap(tel, 'menu', tel.locator('.bottom-sheet').getByRole('button', { name: /Menü yönetimi/ }), { lead: 800, hold: 1500 });
      const row = tel.locator('article.menu-row', { hasText: PRICED }).first();
      await row.waitFor({ timeout: 20000 });
      await bring(tel, row, 300, 1100);
      rec.mark('list');
      info.rowBefore = (await row.innerText()).replace(/\s+/g, ' ');
      await rec.tap(tel, 'edit', row.getByRole('button', { name: /Düzenle/ }), { lead: 1000, hold: 1500 });
      const editor = dialog(tel), price = editor.getByLabel('Fiyat (TL)');
      await price.waitFor({ timeout: 20000 });
      await price.scrollIntoViewIfNeeded(); await pause(tel, 600);
      rec.mark('editor');
      const old = Number((await price.inputValue()).replace(/\./g, '').replace(',', '.'));
      const fresh = old + 20;
      info.price = { old, fresh };
      await retype(tel, rec, 'price', price, String(fresh), 170);
      await pause(tel, 700);
      rec.mark('typed');
      await rec.tap(tel, 'save', editor.getByRole('button', { name: 'Kaydet ve yayınla' }), { lead: 1000, hold: 300 });
      await editor.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
      await pause(tel, 1000);
      await bring(tel, row, 300, 700);
      rec.mark('saved');
      await rec.look(tel, 'rowAfter', row, 2800);
      info.rowAfter = (await row.innerText()).replace(/\s+/g, ' ');
      await rec.stop();
      await phone.ctx.close();

      const gctx = await k.phoneContext(); await gctx.addInitScript('window.__molaNoFinger = true');
      const g = await gctx.newPage();
      await k.openMenu(g, await tokenOf('Masa 12'));
      console.log('Kayıt: uzak-musteri');
      const recG = new Recorder(g, join(OUT, 'uzak-musteri'), PHONE);
      await recG.start(); await pause(g, 1100);
      await recG.tap(g, 'tatlilar', g.locator('.category-tabs').getByRole('button', { name: 'Tatlılar' }), { lead: 800, hold: 900 });
      const pc = g.locator('.product-card', { hasText: PRICED }).first();
      await bring(g, pc, 150, 1000); await imagesOnScreen(g);
      recG.mark('grid');
      await recG.look(g, 'card', pc, 3600);
      info.guestPrice = (await pc.innerText()).replace(/\s+/g, ' ');
      await recG.stop();
      await gctx.close();
    }
    await tablet.ctx.close();
  } catch (e) {
    let i = 0;
    for (const b of [k.deskBrowser, k.phoneBrowser]) for (const c of b?.contexts() ?? []) for (const p of c.pages()) await p.screenshot({ path: join(BASE, `hata-${++i}.png`) }).catch(() => {});
    throw e;
  } finally {
    writeFileSync(join(OUT, only.length ? `bilgi-${only.join('-')}.json` : 'bilgi.json'), JSON.stringify(info, null, 1));
    await k.close();
  }
}
await main();
