/*
 * Instagram blok 3 (stok, rezervasyon, Mola Yardım, gün sonu): recordings of the REAL app for the three videos and the
 * screenshot of the gün sonu e-mail (edit: scripts/sosyal/blok3-kurgu.ts). Never real data: one run on a fresh Mola Merkez +
 * demo café ("Mola Örnek Kafe", shared parts: scripts/sosyal/kayit-ortak.ts) in .local/sosyal/blok3/run-<zaman>/.
 *
 * The run plays on the recording clock (kit({ saat, gun })): the demo café is made with a week of history up to yesterday
 * evening, its floor settled and its kasa closed off camera; this morning the kasa is opened and the morning's tables are
 * served and paid, then Stok is set up as an owner does it (Kit.setUpStock: a few ingredients, Süt just above its limit, the
 * recipes of the drinks). Then:
 *
 *   stok-sahip     12:05 the owner's tablet (1024×768): Stok → Reçeteler (Caffè Latte: espresso, süt) → Malzemeler (Süt 4,3 L,
 *   stok-garson    limit 4 L); the waiter's tablet sends 2 Caffè Latte for Masa 07; the owner's Malzemeler again: Süt
 *                  3,9 L "Az kaldı" (and the "Süt azaldı" notification when it comes).
 *   rez-ajanda     18:50 the owner's tablet: Ajanda ve rezervasyon → Saat 19:15 → Masa 05 → Ayşe Yılmaz, 4 kişi → "Kaydet";
 *                  then Masalar: Masa 05 "Rezerve · Ayşe Yılmaz · 4 kişi · 19:15".
 *   rez-geldi      19:12 the same tablet: Masa 05 → "Geldi": the table opens for her ("Ayşe Yılmaz masaya oturdu.").
 *   yardim         19:30 the owner's phone: Mola Yardım → "süt aldım ne yapmalıyım" (the answer, "Videoda izleyin") →
 *                  "kampnya nasıl yapılır" ("Bunu mu demek istediniz?") → the first choice. YouTube is never opened.
 *   (off camera)   the evening's tables, the gün sonu (the cashier's closing): the gün sonu e-mail goes to a test SMTP server
 *                  on this computer (never a real mailbox); its HTML is shot on a phone → kayit/ekran/gun-sonu-eposta.png.
 *
 *   npx tsx scripts/sosyal/blok3-kayit.ts        (needs `npm run build`; ~15 minutes)
 *   BLOK3_HIZLI=1 …                             a quick rehearsal (3 days of history, fewer tables)
 *
 * No pointer: every tap goes through Recorder.tap (box saved, a still lead-in the edit cuts; the edit draws a soft ring).
 * Ports: café 3740, Mola Merkez 3741. Every process is stopped at the end.
 * Output: .local/sosyal/blok3/kayit/<klip>/ (meta.json), kayit/ekran/*.png and kayit/bilgi.json (the figures on screen).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { NO_HINTS, PHONE, ROOT, Recorder, dialog, istanbul, kit, nav, pause, retype, tableCard, typeIn, type RecipeSeed, type StockSeed, type Want } from './kayit-ortak';
import { decodeParts, fakeSmtp } from '../../tests/fake-smtp';

const BASE = join(ROOT, '.local', 'sosyal', 'blok3');
const OUT = join(BASE, 'kayit');
const SHOTS = join(OUT, 'ekran');
const FAST = !!process.env.BLOK3_HIZLI;
const run = join(BASE, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const k = kit({ run, kafePort: 3740, merkezPort: 3741, saat: istanbul(-1, 22, 10), gun: FAST ? 3 : 7 });
mkdirSync(SHOTS, { recursive: true });
const info: Record<string, unknown> = {};
/** The demo owner's (Serkan Yıldız) report addresses: only the run's fake SMTP server ever sees them. */
const REPORT_FROM = 'ornekkafe.rapor@gmail.com', REPORT_TO = 'serkan@ornekkafe.com';
/** The owner's and the waiter's tablet: 1024×768 (2×), so their text stays readable in a 1080 px wide post. */
const IPAD = { width: 1024, height: 768, scale: 2 };
const STOCK_TABLE = 'Masa 07', RESV_TABLE = 'Masa 05', GUEST = 'Ayşe Yılmaz';

/** Stok as the owner set it up (a few ingredients, so the cards fit the tablet): Süt just above its limit. */
const ITEMS: StockSeed[] = [
  { name: 'Espresso çekirdeği', unit: 'g', initial: 2400, min: 500, price: 900 }, { name: 'Süt', unit: 'ml', initial: 4300, min: 4000, price: 36 },
  { name: 'Türk kahvesi', unit: 'g', initial: 1200, min: 250, price: 800 }, { name: 'Siyah çay', unit: 'g', initial: 1500, min: 300, price: 300 },
  { name: 'Limon', unit: 'piece', initial: 40, min: 10, price: 8 }, { name: 'Şeker', unit: 'g', initial: 5000, min: 1000, price: 40 },
];
const RECIPES: RecipeSeed[] = [
  { product: 'Caffè Latte', items: [['Espresso çekirdeği', 18], ['Süt', 200]] },
  { product: 'Americano', items: [['Espresso çekirdeği', 18]] },
  { product: 'Türk Kahvesi', items: [['Türk kahvesi', 7]] },
  { product: 'Demleme Çay', items: [['Siyah çay', 6]] },
  { product: 'Ev Yapımı Limonata', items: [['Limon', 3], ['Şeker', 40]] },
];
type Visit = { table: string; at: number; lines: Want[]; method: 'cash' | 'card' };
/** This morning's tables (off camera, before Stok was set up): ordered at their minute, made, served, paid 35 minutes later. */
const MORNING: Visit[] = [
  { table: 'Masa 02', at: 8 * 60 + 25, lines: [['Türk Kahvesi', 4], ['Demleme Çay', 4], ['Fırın Sütlaç', 2], ['Künefe', 2]], method: 'cash' },
  { table: 'Masa 06', at: 9 * 60 + 5, lines: [['Caffè Latte', 4, ['Standart']], ['San Sebastian', 3], ['Americano', 1, ['Standart']]], method: 'card' },
  { table: 'Masa 09', at: 9 * 60 + 45, lines: [['Americano', 3, ['Standart']], ['Künefe', 3], ['Ayran', 3], ['Profiterol', 2]], method: 'card' },
  { table: 'Masa 03', at: 10 * 60 + 25, lines: [['Türk Kahvesi', 5], ['Fıstıklı Baklava', 3], ['Kazandibi', 2]], method: 'card' },
  { table: 'Masa 11', at: 11 * 60 + 5, lines: [['Demleme Çay', 4], ['Çikolatalı Brownie', 3], ['Caffè Latte', 2, ['Standart']], ['San Sebastian', 2]], method: 'cash' },
];
/** The afternoon (off camera, after the stock clip; no more milk drinks). */
const AFTERNOON: Visit[] = [
  { table: 'Masa 01', at: 13 * 60 + 10, lines: [['Ayran', 4], ['Künefe', 4], ['Türk Kahvesi', 2]], method: 'card' },
  { table: 'Masa 10', at: 13 * 60 + 50, lines: [['Türk Kahvesi', 4], ['Profiterol', 3], ['Fıstıklı Baklava', 2]], method: 'cash' },
  { table: 'Masa 12', at: 14 * 60 + 35, lines: [['Demleme Çay', 5], ['Fırın Sütlaç', 3], ['Kazandibi', 2]], method: 'card' },
  { table: 'Masa 04', at: 15 * 60 + 20, lines: [['Ev Yapımı Limonata', 4], ['San Sebastian', 3], ['Çikolatalı Brownie', 2]], method: 'card' },
  { table: 'Masa 08', at: 16 * 60 + 5, lines: [['Americano', 3, ['Standart']], ['Çikolatalı Brownie', 3], ['Künefe', 2]], method: 'card' },
  { table: 'Masa 14', at: 16 * 60 + 50, lines: [['Türk Kahvesi', 4], ['Fıstıklı Baklava', 4]], method: 'card' },
  { table: 'Masa 03', at: 17 * 60 + 35, lines: [['Demleme Çay', 4], ['Künefe', 3], ['Ayran', 2]], method: 'cash' },
];
/** The evening after the clips (off camera): Masa 05 is Ayşe Yılmaz's table. */
const EVENING: Visit[] = [
  { table: RESV_TABLE, at: 19 * 60 + 40, lines: [['Türk Kahvesi', 4], ['Künefe', 4], ['Fıstıklı Baklava', 2]], method: 'card' },
  { table: 'Masa 09', at: 20 * 60 + 18, lines: [['Demleme Çay', 6], ['San Sebastian', 3], ['Profiterol', 3]], method: 'cash' },
  { table: 'Masa 13', at: 20 * 60 + 56, lines: [['Ayran', 4], ['Künefe', 4], ['Profiterol', 2]], method: 'card' },
  { table: 'Masa 02', at: 21 * 60 + 34, lines: [['Türk Kahvesi', 5], ['Kazandibi', 3], ['Fırın Sütlaç', 3]], method: 'card' },
  { table: 'Masa 10', at: 22 * 60 + 12, lines: [['Ev Yapımı Limonata', 4], ['Çikolatalı Brownie', 4], ['San Sebastian', 2]], method: 'card' },
];

const stockTab = (page: Page, name: string) => page.locator('.stock-tabs').getByText(name, { exact: true });
const itemCard = (page: Page, name: string) => page.locator('.stock-item', { has: page.locator('.stock-item-head strong', { hasText: new RegExp(`^${name}$`) }) }).first();
const recipeRow = (page: Page, name: string) => page.locator('.stock-row', { has: page.locator('.stock-row-name strong', { hasText: new RegExp(`^${name}$`) }) }).first();
const text = async (l: ReturnType<Page['locator']>) => (await l.innerText({ timeout: 5000 }).catch(() => '')).replace(/\s+/g, ' ').trim();

/**
 * A staff screen signed in fresh (after a jump of the clock the old session is locked), on the café's own screens: no finger,
 * no spell-check squiggles, Mola Yardım's one-time hint closed, the sounds unlocked (a click on the header), Masalar at the top.
 */
async function screen(user: string, kind: 'tablet' | 'phone'): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = kind === 'phone' ? await k.phoneContext() : await k.tabletContext(IPAD);
  await ctx.addInitScript(`window.__molaNoFinger = true; ${NO_HINTS}`);
  // Mola Yardım's "Videoda izleyin" links open YouTube: never reached from here.
  await ctx.route(/^https:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be|ytimg\.com)\//, r => r.abort());
  const page = await ctx.newPage();
  await k.login(page, user);
  await page.goto(`${k.KAFE}/`); await pause(page, 1500);
  if (kind === 'tablet') { await page.mouse.click(IPAD.width / 2, 12); await pause(page, 500); }
  const sound = page.getByText(/Ses kapalı/).first();
  if (await sound.isVisible().catch(() => false)) { await sound.click(); await pause(page, 500); }
  await page.evaluate('scrollTo(0, 0)');
  return { ctx, page };
}

async function main() {
  await k.launch();
  const desk = k.deskBrowser;
  const smtp = await fakeSmtp('kullanilmaz');
  try {
    await k.startServers();
    await k.prepareMenu(desk, { waiterApproval: false, changeSeconds: 0 });
    await k.calm(desk, true);
    await k.settleAll();
    await k.closeKasa();
    const ownerPost = async (path: string, body: unknown) => { const api = await k.ownerApi(desk); try { return await k.post(api.req, path, body); } finally { await api.close(); } };

    // ===== This morning (off camera): the kasa opened, the tables; Stok set up =====
    await k.setClock(istanbul(0, 8, 20));
    await k.openKasa(50000);
    await k.serveDay(FAST ? MORNING.slice(0, 2) : MORNING);
    await k.setClock(istanbul(0, 11, 50));
    await k.setUpStock(ITEMS, RECIPES);
    info.stockMorning = await k.stockLevels();
    console.log('Stok:', JSON.stringify(info.stockMorning));

    // ===== Post 4: a sale takes its ingredients off Stok =====
    await k.setClock(istanbul(0, 12, 5));
    await k.readNotifications();
    { const owner = await screen('isletme', 'tablet'), op = owner.page;
      const waiter = await screen('garson', 'tablet'), tp = waiter.page;
      // The owner: Stok → Reçeteler, Caffè Latte's row near the top (off camera).
      await nav(op, 'Stok').click(); await pause(op, 1500);
      await stockTab(op, 'Reçeteler').click(); await pause(op, 1500);
      await op.evaluate('scrollTo(0, 0)'); await pause(op, 500);
      // The waiter: Masa 07's basket made ready off camera (2 Caffè Latte, Standart).
      await nav(tp, 'Masalar').click(); await pause(tp, 800); await tp.evaluate('scrollTo(0, 0)');
      await tableCard(tp, STOCK_TABLE).click(); await pause(tp, 1200);
      await dialog(tp).getByRole('button', { name: /Sipariş ekle/ }).click(); await pause(tp, 1500);
      await tp.locator('.staff-card', { hasText: 'Caffè Latte' }).first().click(); await pause(tp, 900);
      await dialog(tp).getByText(/^Standart$/).first().click().catch(() => {}); await pause(tp, 300);
      await dialog(tp).getByRole('button', { name: 'Adedi artır' }).click(); await pause(tp, 300);
      await dialog(tp).getByRole('button', { name: /Sepete ekle/ }).click(); await pause(tp, 900);
      await tp.locator('.staff-basket-open').click(); await pause(tp, 1600);
      info.basket = await text(dialog(tp));

      console.log('Kayıt: stok-sahip / stok-garson');
      const recO = new Recorder(op, join(OUT, 'stok-sahip'), IPAD);
      await recO.start(); await pause(op, 1200);
      recO.mark('recipes');
      await recO.look(op, 'recipe', recipeRow(op, 'Caffè Latte'), 3000);
      info.recipe = await text(recipeRow(op, 'Caffè Latte'));
      await recO.tap(op, 'items', stockTab(op, 'Malzemeler'), { lead: 900, hold: 1300 });
      await op.evaluate('scrollTo(0, 0)');
      recO.mark('items');
      await recO.look(op, 'milkBefore', itemCard(op, 'Süt'), 3200);
      info.milkBefore = await text(itemCard(op, 'Süt'));
      recO.mark('toWaiter');
      // The waiter's tablet: "Siparişi gönder" (the owner's screen keeps recording; the edit shows the tablet now).
      const recT = new Recorder(tp, join(OUT, 'stok-garson'), IPAD);
      await recT.start(); await pause(tp, 1200);
      await recT.tap(tp, 'send', dialog(tp).getByRole('button', { name: 'Siparişi gönder', exact: true }), { lead: 1200, hold: 200 });
      await tp.getByText(/mutfağa gönderildi/).first().waitFor({ timeout: 15000 }).catch(() => {});
      recT.mark('sent');
      await pause(tp, 2600);
      await recT.stop();
      // The owner again: Malzemeler (a tap reads Stok again).
      const toast = op.getByTestId('notification-toast').first();
      recO.mark('back');
      await pause(op, 900);
      await recO.tap(op, 'again', stockTab(op, 'Malzemeler'), { lead: 900, hold: 300 });
      await itemCard(op, 'Süt').locator('.stock-chip').waitFor({ timeout: 20000 }).catch(() => {});
      await op.evaluate('scrollTo(0, 0)'); await pause(op, 900);
      recO.mark('after');
      await recO.look(op, 'milkAfter', itemCard(op, 'Süt'), 3400);
      info.milkAfter = await text(itemCard(op, 'Süt'));
      if (await toast.waitFor({ timeout: 6000 }).then(() => true).catch(() => false)) {
        recO.mark('toast'); await pause(op, 400);
        await recO.look(op, 'toast', toast, 3000);
        info.toast = await text(toast);
      }
      await pause(op, 600);
      await recO.stop();
      await op.screenshot({ path: join(SHOTS, 'stok-sonra.png') });
      for (const s of [owner, waiter]) await s.ctx.close(); }
    info.stockAfter = await k.stockLevels();
    // Off camera: Masa 07 served and paid.
    await k.advance(['preparing', 'ready', 'served']);
    await k.setClock(istanbul(0, 12, 40));
    await k.pays(STOCK_TABLE, 'card');
    await k.cleanAll();
    await k.serveDay(FAST ? AFTERNOON.slice(0, 2) : AFTERNOON);

    // ===== Post 6: a reservation, then the table on Masalar, then the guest arrives =====
    await k.setClock(istanbul(0, 18, 50));
    await k.readNotifications();
    { const owner = await screen('isletme', 'tablet'), op = owner.page;
      await nav(op, 'Masalar').click(); await pause(op, 1000); await op.evaluate('scrollTo(0, 0)');
      console.log('Kayıt: rez-ajanda');
      const rec = new Recorder(op, join(OUT, 'rez-ajanda'), IPAD);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', nav(op, 'Ajanda ve rezervasyon'), { lead: 1000, hold: 1500 });
      const parts = op.getByRole('navigation', { name: 'Ajanda bölümleri' }).getByRole('button', { name: 'Rezervasyonlar' });
      if (await parts.isVisible().catch(() => false) && (await parts.getAttribute('aria-pressed').catch(() => null)) === 'false') { await parts.click(); await pause(op, 900); }
      rec.mark('plan');
      await retype(op, rec, 'time', op.locator('.resv-plan-time input'), '19:15');
      await op.keyboard.press('Tab'); await pause(op, 1200);
      rec.mark('timed');
      await rec.tap(op, 'table', op.locator('.resv-plan button', { hasText: RESV_TABLE }).first(), { lead: 1000, hold: 1300 });
      rec.mark('form');
      const f = dialog(op);
      await typeIn(op, rec, 'name', f.getByPlaceholder('Ör. Ahmet Yılmaz'), GUEST, { delay: 85 });
      await retype(op, rec, 'people', f.getByLabel('Kişi sayısı'), '4');
      await pause(op, 700);
      rec.mark('filled');
      info.form = await text(f);
      await rec.tap(op, 'save', f.getByRole('button', { name: 'Kaydet', exact: true }), { lead: 1000, hold: 200 });
      await f.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
      await pause(op, 900);
      rec.mark('saved');
      const tile = op.locator(`li.plan-cell[data-table="${RESV_TABLE}"]`).first();
      await rec.look(op, 'tile', tile, 2600);
      info.tile = await text(tile);
      info.notice = await text(op.locator('.notice-success').last());
      await rec.tap(op, 'masalar', nav(op, 'Masalar'), { lead: 900, hold: 1300 });
      await op.evaluate('scrollTo(0, 0)'); await pause(op, 500);
      rec.mark('floor');
      await rec.look(op, 'card', tableCard(op, RESV_TABLE), 3400);
      info.card = await text(tableCard(op, RESV_TABLE));
      await rec.stop();
      await owner.ctx.close(); }

    await k.setClock(istanbul(0, 19, 12));
    await k.readNotifications();
    { const owner = await screen('isletme', 'tablet'), op = owner.page;
      await nav(op, 'Masalar').click(); await pause(op, 1200); await op.evaluate('scrollTo(0, 0)');
      console.log('Kayıt: rez-geldi');
      const rec = new Recorder(op, join(OUT, 'rez-geldi'), IPAD);
      await rec.start(); await pause(op, 1200);
      await rec.look(op, 'card', tableCard(op, RESV_TABLE), 1800);
      await rec.tap(op, 'open', tableCard(op, RESV_TABLE), { lead: 700, hold: 1400 });
      const d = dialog(op);
      rec.mark('window');
      info.window = await text(d);
      await rec.tap(op, 'came', d.getByRole('button', { name: 'Geldi', exact: true }).first(), { lead: 1300, hold: 300 });
      const toast = op.locator('.toast').first();
      await toast.waitFor({ timeout: 15000 }).catch(() => {});
      await pause(op, 600);
      rec.mark('seated');
      info.toast = await text(toast);
      await rec.look(op, 'cardAfter', tableCard(op, RESV_TABLE), 3600);
      info.cardAfter = await text(tableCard(op, RESV_TABLE));
      await rec.stop();
      await owner.ctx.close(); }

    // ===== Post 8: Mola Yardım on the owner's phone =====
    await k.setClock(istanbul(0, 19, 30));
    await k.readNotifications();
    { const owner = await screen('isletme', 'phone'), pp = owner.page;
      console.log('Kayıt: yardim');
      const rec = new Recorder(pp, join(OUT, 'yardim'), PHONE);
      await rec.start(); await pause(pp, 1200);
      await rec.tap(pp, 'help', pp.getByRole('button', { name: 'Mola Yardım' }).first(), { lead: 1000, hold: 1400 });
      rec.mark('panel');
      const sheet = pp.locator('dialog.help-sheet'), field = sheet.getByLabel('Sorunuzu yazın');
      await typeIn(pp, rec, 'ask', field, 'süt aldım ne yapmalıyım', { delay: 80 });
      await pause(pp, 400);
      await pp.keyboard.press('Enter');
      const answer = sheet.locator('.help-answer').last();
      await answer.waitFor({ timeout: 15000 });
      await pause(pp, 900);
      rec.mark('answer');
      await rec.look(pp, 'answer', answer, 4200);
      info.answer = await text(answer);
      await typeIn(pp, rec, 'ask2', field, 'kampnya nasıl yapılır', { delay: 90 });
      await pause(pp, 400);
      await pp.keyboard.press('Enter');
      const guess = sheet.locator('.help-guess').last();
      await guess.waitFor({ timeout: 15000 });
      await pause(pp, 900);
      rec.mark('guess');
      await rec.look(pp, 'guess', guess, 3400);
      info.guess = await text(guess);
      await rec.tap(pp, 'choice', guess.locator('button.help-question').first(), { lead: 900, hold: 900 });
      const answer2 = sheet.locator('.help-answer').last();
      await answer2.waitFor({ timeout: 15000 });
      await pause(pp, 700);
      rec.mark('answer2');
      await rec.look(pp, 'answer2', answer2, 3600);
      info.answer2 = await text(answer2);
      await rec.stop();
      await owner.ctx.close(); }

    // ===== The evening and the gün sonu (off camera): the day report by e-mail to the test SMTP server =====
    await ownerPost('/api/staff/email-reports', { account: { provider: 'other', host: '127.0.0.1', port: smtp.port, security: 'none', user: '', from: REPORT_FROM }, to: [REPORT_TO], reports: { day: true, week: false, month: false, year: false } });
    await k.serveDay(FAST ? EVENING.slice(0, 1) : EVENING);
    await k.settleAll();
    await k.setClock(istanbul(0, 23, 5));
    info.closedCash = await k.closeKasa();
    // Today's report (switching the reports on may also send yesterday's at once): the one that names today's date.
    const today = new Date(k.now()).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', timeZone: 'Europe/Istanbul' });
    const todays = () => smtp.received.filter(m => decodeParts(m.data).some(p => !p.name && p.type === 'text/plain' && (p.text.split(/\r?\n/)[2] ?? '').includes(today))).at(-1);
    for (let i = 0; i < 200 && !todays(); i++) await new Promise(r => setTimeout(r, 1000));
    const mail = todays();
    if (!mail) throw new Error(`Gün sonu raporu e-postası gelmedi (${today}; gelen ${smtp.received.length}).`);
    const parts = decodeParts(mail.data), html = parts.find(p => !p.name && p.type === 'text/html')?.text;
    info.mail = { subject: /Subject: ([^\n]+)/.exec(mail.data)?.[1], files: parts.filter(p => p.name).map(p => p.name), text: parts.find(p => !p.name && p.type === 'text/plain')?.text.slice(0, 1500) };
    if (!html) throw new Error('Gün sonu e-postasında HTML yok.');
    writeFileSync(join(SHOTS, 'gun-sonu-eposta.html'), html);
    // The e-mail's own HTML on a phone (3×), as a mail app shows its body.
    { const ctx = await k.phoneContext(); await ctx.addInitScript('window.__molaNoFinger = true');
      const page = await ctx.newPage();
      await page.setContent(html); await pause(page, 600);
      await page.screenshot({ path: join(SHOTS, 'gun-sonu-eposta.png') });
      await page.screenshot({ path: join(SHOTS, 'gun-sonu-eposta-tam.png'), fullPage: true });
      await ctx.close(); }
  } catch (e) {
    let i = 0;
    for (const b of [k.deskBrowser, k.phoneBrowser]) for (const c of b?.contexts() ?? []) for (const p of c.pages()) await p.screenshot({ path: join(BASE, `hata-${++i}.png`) }).catch(() => {});
    throw e;
  } finally {
    writeFileSync(join(OUT, 'bilgi.json'), JSON.stringify(info, null, 1));
    await smtp.close();
    await k.close();
  }
}
await main();
