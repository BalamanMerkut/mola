/*
 * YouTube 00 "Mola'yı 2 dakikada tanıyın" (the channel trailer, first of the introduction series): recordings of the REAL app
 * for one quick tour of the café across its devices (edit: scripts/sosyal/youtube-tanitim-kurgu.ts). One run in story order on
 * a fresh Mola Merkez + demo café ("Mola Örnek Kafe", shared parts: scripts/sosyal/kayit-ortak.ts) in
 * .local/sosyal/youtube/tanitim/run-<zaman>/, plus the built site (site/dist) served here.
 *
 * The run plays on the recording clock (kit({ saat })): the demo is made yesterday evening, its floor settled and its kasa
 * closed off camera. Off camera too: the Mola team's contact on Mola Merkez (destek@molayazilim.com.tr, the web site), the
 * kasa opened at 08:30 and the morning's tables served (some ordered by the guests' phones) so the day's report has figures.
 * Then, at lunch (story order; p1 is recorded last: İşletmemi yönet is made ready just before it, Ayarlar → Uzaktan erişim's
 * phone code, e-mail and Uzaktan yönetim, and from then on the owner's sign-in asks for the phone code):
 *
 *   q1-misafir   the guest at Masa 04 (phone): the QR stand → the menu with photos → "+" Caffè Latte → "Sepete ekle" →
 *                San Sebastian → "Sepetimi görüntüle" → "Siparişi gönder".   + m1-mutfak: the kitchen display at the same time
 *                (the card arrives) → "Hazırlamaya başla" → "Hazır olarak işaretle".
 *   t1-garson    the waiter's tablet from the kitchen's "Hazır" on: the note, "Servise hazır" → "Teslim edildi".
 *   k1-kasa      the counter: Masa 04 → "Ödeme al" → Kart → "Ödemeyi kaydet".
 *   r1-rapor     the owner on the café computer: "Satış ve Raporlar" → Bugün (the sentence and the figures).
 *   p1-telefon   the owner's phone: İşletmemi yönet (signed in off camera): Bugünün satışı, then down the page.
 *   y1-yardim    the owner's top bar: "Mola Yardım" → "İnternet kesilirse ne olur" → the answer.
 *   w1-site      molayazilim.com.tr: the round Mola Yardım button → "Mola ekibine nasıl ulaşırım" → the answer.
 *   d1-destek    the owner's "Destek": Talepler ("Yeni talep") and the Mola team's contact.
 *
 *   npx tsx scripts/sosyal/youtube-tanitim-kayit.ts            (needs `npm run build` and site/dist; ~8 minutes)
 *
 * No pointer: every tap goes through Recorder.tap (box saved, a still lead-in the edit cuts). Phones 390×844 (3×), waiter's
 * tablet 1180×820 (2×), kitchen display, counter and owner windows 1280×800 (2×). Ports: café 3782, Mola Merkez 3794, site
 * 3783. Every process is stopped at the end. Output: .local/sosyal/youtube/tanitim/kayit/<klip>/ (meta.json) and kayit/bilgi.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { Page } from '@playwright/test';
import { DESKTOP, PHONE, ROOT, Recorder, TABLET, imagesOnScreen, istanbul, kit, pause, qrStand, siteServer, smoothScroll, typeIn, type Want } from './kayit-ortak';

const BASE = join(ROOT, '.local', 'sosyal', 'youtube', 'tanitim');
const OUT = join(BASE, 'kayit');
const run = join(BASE, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const k = kit({ run, kafePort: 3782, merkezPort: 3794, saat: istanbul(-1, 22, 10) });
const SITE_PORT = 3783, SITE = `http://127.0.0.1:${SITE_PORT}`;
/** The demo owner's (Serkan Yıldız) e-mail for İşletmemi yönet: only the run's fake SMTP server ever sees it. */
const OWNER_EMAIL = 'serkan@ornekkafe.com';
const TABLE = 'Masa 04';
mkdirSync(OUT, { recursive: true });
const info: Record<string, unknown> = {};
const ist = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

// ---------- On the screens ----------
const productCard = (page: Page, name: string) => page.locator('.product-card', { hasText: name }).first();
const kitchenCard = (page: Page, table: string) => page.locator('.kitchen-card', { has: page.locator('h3', { hasText: new RegExp(`^${table}$`) }) }).first();
const tableCard = (page: Page, table: string) => page.locator('.table-card', { has: page.locator('h3', { hasText: new RegExp(`^${table}$`) }) }).first();
const nav = (page: Page, name: string) => page.locator('aside nav').getByRole('button', { name: new RegExp(`^${name}`) });
const dialog = (page: Page) => page.getByRole('dialog').last();
const toTop = async (page: Page) => { await page.evaluate('scrollTo({ top: 0, behavior: "smooth" })'); await pause(page, 900); };

/** The morning (off camera): each visit ordered at its minute, made, served and paid 35 minutes later (`qr`: the guest's phone); one after another. */
const MORNING: { table: string; at: number; lines: Want[]; method: 'cash' | 'card'; qr?: boolean }[] = [
  { table: 'Masa 02', at: 8 * 60 + 40, lines: [['Türk Kahvesi', 2], ['Demleme Çay', 2]], method: 'cash' },
  { table: 'Masa 06', at: 9 * 60 + 20, lines: [['Caffè Latte', 2], ['Çikolatalı Brownie', 1]], method: 'card', qr: true },
  { table: 'Masa 09', at: 10 * 60, lines: [['Americano', 2], ['San Sebastian', 1], ['Fıstıklı Baklava', 1]], method: 'card' },
  { table: 'Masa 11', at: 10 * 60 + 40, lines: [['Ev Yapımı Limonata', 2], ['Profiterol', 1]], method: 'card', qr: true },
  { table: 'Masa 03', at: 11 * 60 + 20, lines: [['Demleme Çay', 3], ['Künefe', 1], ['Ayran', 1]], method: 'cash' },
  { table: 'Masa 14', at: 12 * 60, lines: [['Caffè Latte', 1], ['Americano', 1], ['Kazandibi', 1]], method: 'card', qr: true },
];

async function main() {
  await k.launch();
  const desk = k.deskBrowser;
  let site: Server | undefined;
  try {
    await k.startServers();
    site = await siteServer(SITE_PORT);
    await k.prepareMenu(desk, { waiterApproval: false, changeSeconds: 0 });
    await k.calm(desk, true);
    await k.molaContact({ email: 'destek@molayazilim.com.tr', web: 'https://molayazilim.com.tr' });

    // ===== Yesterday evening (off camera): the floor settled, the kasa closed =====
    await k.settleAll();
    info.closedCash = await k.closeKasa();
    console.log('Dün kapandı:', ist(k.now()));

    // ===== This morning (off camera): the kasa opened, the morning's tables (a waiter's tablet connected for the QR orders) =====
    await k.setClock(istanbul(0, 8, 30));
    await k.openKasa();
    const waiter = await k.staffScreen('garson', 'tablet'), tp = waiter.page;
    await k.serveDay(MORNING);
    await k.setClock(istanbul(0, 12, 38));
    await k.readNotifications();
    info.lunch = ist(k.now());

    // The screens of the tour, each signed in and at rest.
    const kitchen = await k.staffScreen('mutfak', 'desktop'), kp = kitchen.page;
    const counter = await k.staffScreen('kasiyer', 'desktop'), cp = counter.page;
    await nav(tp, 'Masalar').click(); await pause(tp, 900); await tp.evaluate('scrollTo(0, 0)');
    await pause(kp, 3000);

    // ===== q1 + m1: the guest's QR order, the kitchen display =====
    console.log('Kayıt: q1-misafir / m1-mutfak');
    { const api = await k.ownerApi(desk), token = (await k.state(api.req)).tables.find(t => t.name === TABLE)!.token; await api.close();
      const gctx = await k.phoneContext(); await gctx.addInitScript('window.__molaNoFinger = true');
      const gp = await gctx.newPage();
      await qrStand(gp, k.guestUrl(token), TABLE);
      const recG = new Recorder(gp, join(OUT, 'q1-misafir'), PHONE), recM = new Recorder(kp, join(OUT, 'm1-mutfak'), DESKTOP);
      await recG.start(); await recM.start();
      await pause(gp, 3400);
      recG.mark('menu');
      await gp.goto(k.guestUrl(token));
      await gp.getByRole('button', { name: /Türk Kahvesi/ }).first().waitFor();
      await imagesOnScreen(gp);
      recG.mark('menuReady'); await pause(gp, 2600);
      await smoothScroll(gp, 330, 1300); await pause(gp, 900); await imagesOnScreen(gp);
      recG.mark('products');
      const add = gp.getByRole('button', { name: /Sepete ekle/ });
      await recG.tap(gp, 'plus', productCard(gp, 'Caffè Latte').locator('.add-circle'), { hold: 1600 });
      recG.mark('detail');
      await recG.tap(gp, 'add', add, { hold: 1000 });
      await recG.tap(gp, 'plus2', productCard(gp, 'San Sebastian').locator('.add-circle'), { hold: 1000 });
      if (await add.isVisible().catch(() => false)) await recG.tap(gp, 'add2', add, { hold: 900 });
      await recG.tap(gp, 'cart', gp.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }), { hold: 1500 });
      recG.mark('cartOpen');
      await recG.tap(gp, 'send', gp.getByRole('button', { name: 'Siparişi gönder', exact: true }), { hold: 100 });
      await gp.getByText(/Siparişiniz alındı|Afiyet olsun/).first().waitFor({ timeout: 15000 });
      recG.mark('sent');
      await kitchenCard(kp, TABLE).waitFor({ timeout: 20000 });
      recM.mark('ticket'); recG.mark('kitchen');
      await pause(gp, 2600);
      await recG.stop();
      info.order = await gp.getByText(/Sipariş(iniz)? #?\d+|#\d+/).first().innerText().catch(() => '');
      await gctx.close();

      await pause(kp, 600);
      await recM.look(kp, 'card', kitchenCard(kp, TABLE), 2600);
      await recM.tap(kp, 'start', kitchenCard(kp, TABLE).getByRole('button', { name: /Hazırlamaya başla/ }), { hold: 1800 });
      recM.mark('started');
      // The waiter's tablet is recorded from just before the kitchen's "Hazır".
      const recT = new Recorder(tp, join(OUT, 't1-garson'), TABLET);
      await recT.start(); await pause(tp, 900);
      await recM.tap(kp, 'ready', kitchenCard(kp, TABLE).getByRole('button', { name: /Hazır olarak işaretle/ }), { hold: 300 });
      recM.mark('ready'); recT.mark('ready');
      await pause(kp, 2400);
      await recM.stop();

      // ===== t1: the waiter serves it =====
      console.log('Kayıt: t1-garson');
      await tp.locator('.nav-count').first().waitFor({ timeout: 20000 });
      recT.mark('count'); await pause(tp, 2400);
      await recT.tap(tp, 'nav', nav(tp, 'Servise hazır'), { lead: 1400, hold: 1400 });
      recT.mark('list');
      const readyCard = tp.locator('.ready-orders article', { hasText: TABLE }).first();
      await recT.look(tp, 'card', readyCard, 2400);
      await recT.tap(tp, 'served', readyCard.getByRole('button', { name: 'Teslim edildi' }), { hold: 300 });
      await tp.getByText('Sipariş teslim edildi.').first().waitFor({ timeout: 15000 }).catch(() => {});
      recT.mark('served'); await pause(tp, 2200);
      await recT.stop(); }

    // ===== k1: the counter takes the payment =====
    console.log('Kayıt: k1-kasa');
    await toTop(cp); await pause(cp, 1500);
    { const rec = new Recorder(cp, join(OUT, 'k1-kasa'), DESKTOP);
      await rec.start(); await pause(cp, 1200);
      await rec.tap(cp, 'table', tableCard(cp, TABLE), { hold: 1400 });
      await rec.look(cp, 'bill', dialog(cp).locator('.table-detail-summary').first(), 2200);
      await rec.tap(cp, 'pay', dialog(cp).getByRole('button', { name: 'Ödeme al' }), { hold: 1400 });
      rec.mark('modal');
      await rec.tap(cp, 'card', dialog(cp).locator('.payment-method').getByRole('button', { name: 'Kart' }), { hold: 1200 });
      await rec.tap(cp, 'save', dialog(cp).getByRole('button', { name: /Ödemeyi kaydet/ }), { hold: 200 });
      await cp.getByText(/Hesap kapandı|Ödeme tamamlandı/).first().waitFor({ timeout: 15000 });
      rec.mark('paid'); await pause(cp, 2600);
      await rec.stop(); }
    await k.setClock(istanbul(0, 12, 52));
    await k.readNotifications();

    // ===== r1: the owner's report on the café computer =====
    console.log('Kayıt: r1-rapor');
    const owner = await k.staffScreen('isletme', 'desktop'), op = owner.page;
    { const rec = new Recorder(op, join(OUT, 'r1-rapor'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', op.locator('aside nav').getByRole('button', { name: 'Satış ve Raporlar', exact: true }), { hold: 1800 });
      rec.mark('reports');
      const sentence = op.locator('.simple-sentence').first();
      await sentence.waitFor({ timeout: 15000 }); await pause(op, 600);
      await rec.look(op, 'sentence', sentence, 3600);
      await rec.look(op, 'grid', op.locator('.simple-grid').first(), 3600);
      await rec.stop();
      info.sentence = await sentence.innerText().catch(() => '');
      info.grid = await op.locator('.simple-grid').first().innerText().catch(() => ''); }

    // ===== y1: Mola Yardım in the app =====
    console.log('Kayıt: y1-yardim');
    await nav(op, 'Masalar').click(); await pause(op, 1200); await toTop(op);
    { const rec = new Recorder(op, join(OUT, 'y1-yardim'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'help', op.getByRole('button', { name: 'Mola Yardım' }), { lead: 2200, hold: 1600 });
      rec.mark('panel');
      const sheet = op.locator('dialog.help-sheet');
      await typeIn(op, rec, 'ask', sheet.getByLabel('Sorunuzu yazın'), 'İnternet kesilirse ne olur', { delay: 75 });
      await pause(op, 400);
      await op.keyboard.press('Enter');
      const answer = sheet.locator('.help-answer').last();
      await answer.waitFor({ timeout: 15000 });
      rec.mark('answer'); await pause(op, 900);
      await rec.look(op, 'answer', answer, 5000);
      info.helpAnswer = await answer.innerText().catch(() => '');
      await rec.tap(op, 'close', sheet.getByRole('button', { name: 'Yardımı kapat' }), { hold: 900 });
      await rec.stop(); }

    // ===== w1: Mola Yardım on molayazilim.com.tr =====
    console.log('Kayıt: w1-site');
    { const sctx = await k.desktopContext();
      // The button's one-time speech bubble stays away (it comes after 20 s; remembered per browser session).
      await sctx.addInitScript(`try { sessionStorage.setItem('mola-yardim-balon', '1'); } catch (e) {}`);
      const sp = await sctx.newPage();
      await sp.goto(`${SITE}/`); await sp.waitForLoadState('networkidle').catch(() => {}); await pause(sp, 1500);
      const rec = new Recorder(sp, join(OUT, 'w1-site'), DESKTOP);
      await rec.start(); await pause(sp, 2000);
      await rec.tap(sp, 'fab', sp.locator('.yardim-fab'), { lead: 1800, hold: 1600 });
      await sp.locator('#yardim-sorgu').waitFor({ timeout: 15000 });
      rec.mark('panel');
      await typeIn(sp, rec, 'ask', sp.locator('#yardim-sorgu'), 'Mola ekibine nasıl ulaşırım', { delay: 75 });
      await pause(sp, 400);
      await sp.keyboard.press('Enter');
      const answer = sp.locator('.yardim-cevap').last();
      await answer.waitFor({ timeout: 15000 });
      rec.mark('answer'); await pause(sp, 900);
      await rec.look(sp, 'answer', answer, 4800);
      await rec.stop();
      info.siteTitle = await sp.title();
      info.siteAnswer = await answer.innerText().catch(() => '');
      await sctx.close(); }

    // ===== d1: Destek =====
    console.log('Kayıt: d1-destek');
    { const rec = new Recorder(op, join(OUT, 'd1-destek'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', op.locator('.support-nav'), { hold: 1800 });
      rec.mark('page');
      const contact = op.locator('.support-info').first();
      await contact.waitFor({ timeout: 15000 });
      await rec.look(op, 'tickets', op.locator('.support-tickets').first(), 2600);
      await rec.look(op, 'new', op.getByRole('button', { name: 'Yeni talep' }).first(), 2400);
      await contact.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'smooth' })); await pause(op, 1300);
      rec.mark('contact');
      await rec.look(op, 'contact', contact.locator('.mola-contact'), 3600);
      await rec.stop();
      info.contact = await contact.innerText().catch(() => ''); }

    // ===== p1: İşletmemi yönet on the owner's phone (made ready and signed in off camera; only through Mola Merkez, as from
    // outside). Last: from here on the owner's sign-in asks for the phone code. =====
    const remote = await k.ownerRemote({ email: OWNER_EMAIL, admin: true });
    console.log('Kayıt: p1-telefon');
    { const tctx = await k.phoneContext(); await tctx.addInitScript('window.__molaNoFinger = true');
      await tctx.route(`${k.KAFE}/**`, r => r.abort());
      const tel = await tctx.newPage();
      await tel.goto(`${k.MERKEZ}/yonet`);
      const login = tel.getByRole('form', { name: 'Giriş yap' });
      await login.getByLabel('E-posta').fill(OWNER_EMAIL);
      await login.getByLabel('Şifre', { exact: true }).fill('MolaDemo!2026');
      await login.getByRole('button', { name: 'Devam' }).click();
      const codeForm = tel.getByRole('form', { name: 'Telefon kodu' });
      await codeForm.getByLabel('Telefon kodu').fill(await remote.code());
      await codeForm.getByRole('button', { name: 'Giriş yap' }).click();
      // With Uzaktan yönetim on, the phone opens on the café's screens ("Uzaktan"); its bar's "Raporlar" goes to the reports.
      const hero = tel.getByRole('region', { name: 'Bugünün satışı' }), reports = tel.getByRole('button', { name: 'Raporlar', exact: true });
      await hero.or(reports).first().waitFor({ timeout: 30000 });
      if (await reports.isVisible().catch(() => false)) { await pause(tel, 1500); await reports.click(); }
      await hero.waitFor({ timeout: 30000 }).catch(async e => { await tel.screenshot({ path: join(BASE, 'hata-telefon.png') }); throw e; });
      await pause(tel, 2500); await tel.evaluate('scrollTo(0, 0)'); await imagesOnScreen(tel);
      const rec = new Recorder(tel, join(OUT, 'p1-telefon'), PHONE);
      await rec.start(); await pause(tel, 1200);
      await rec.look(tel, 'hero', hero, 3400);
      await smoothScroll(tel, 430, 1800); await pause(tel, 400);
      rec.mark('down'); await pause(tel, 3000);
      await rec.stop();
      info.phone = await hero.innerText().catch(() => '');
      info.phoneTop = await tel.locator('.rp-header').first().innerText().catch(() => '');
      await tctx.close(); }

    for (const s of [owner, counter, kitchen, waiter]) await s.ctx.close();
  } catch (e) {
    for (const b of [k.deskBrowser, k.phoneBrowser]) for (const c of b?.contexts() ?? []) for (const [i, p] of c.pages().entries()) await p.screenshot({ path: join(BASE, `hata-${b === k.phoneBrowser ? 'tel' : 'ekran'}-${i}.png`) }).catch(() => {});
    throw e;
  } finally {
    writeFileSync(join(OUT, 'bilgi.json'), JSON.stringify(info, null, 1));
    site?.close();
    await k.close();
  }
}
await main();
