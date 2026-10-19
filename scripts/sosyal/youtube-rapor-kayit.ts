/*
 * YouTube 03 "Raporlar" (introduction series): recordings of the REAL app for one linear story of the owner's reports (edit:
 * scripts/sosyal/youtube-rapor-kurgu.ts). One run in story order on a fresh Mola Merkez + demo café ("Mola Örnek Kafe",
 * shared parts: scripts/sosyal/kayit-ortak.ts) in .local/sosyal/youtube/rapor/run-<zaman>/.
 *
 * The run plays on the recording clock (kit({ saat, gun })): the demo café is made with 62 days of history up to four days ago
 * (so 30 gün has a previous 30 days to compare with). Off camera then: the POS rate left empty (a new café's default: card
 * commission unknown), Stok set up (Kârlılık has costs), and three days played as a café lives them (Kit.serveDay with the day:
 * the kasa opened in the morning, tables, guests' QR orders, masasız tickets at the counter, cash expenses, the cashier's gün
 * sonu with a small difference), then this morning. From 12:58 the owner on the café computer:
 *
 *   r1-bugun     "Satış ve Raporlar": the plain summary of today (the sentence, the cards, the top 3 and Kasa durumu).
 *   r2-donem     "7 gün", "30 gün" (the sentence compares with the period before), "Yıl" (its menu), back to "30 gün".
 *   r3-detay     "Detaylı göster": Özet of 30 gün (the figures with their change, the chart, Kanallar, KDV dökümü).
 *   r4-urunler   Ürünler (the table, the "Tatlılar" filter).
 *   r5-personel  Personel → Çalışanlar: "Müşterilerin kendi verdiği siparişler" (the QR share) and the staff's share.
 *   r6-karlilik  Satış → Kârlılık on "Bugün" (one glance; video 02 covers it).
 *   r7-kapanis   Kasa ve giderler → Kapanışlar, "7 gün": the closings (beklenen, sayılan, fark), one opened.
 *   r8-yazdir    Satış ve Raporlar, "7 gün" → "Yazdır ve paylaş": "Yazdır / PDF" (the A4 page, "PDF indir"), then
 *                "Muhasebeci için indir" ("Excel dosyasını indir").
 *   s1-pos       the setting: Kasa ve giderler → Kasa ayarları → Kart ve yazar kasa → "POS komisyon oranı": 1,75.
 *   s2-eposta    the setting: "Yazdır ve paylaş" → "Raporları gönder": the café's e-mail account (saved before, off camera),
 *                the addresses typed and saved, "Gün sonu raporu", "Haftalık rapor", "Aylık rapor" turned on.
 * Off camera: the afternoon and evening (card commission now known), the gün sonu: the day report goes by e-mail (a test SMTP
 * server on this computer stands in for the mailbox; the account shown on camera is never contacted). The next day at noon:
 *   s3-sonra     Satış ve Raporlar, Bugün: Elde kalan with the card commission (its ⓘ breakdown).
 *   s4-gelen     Bildirimler: "Gün sonu raporu"; "Raporları gönder": "Son raporlar" · Gönderildi.
 *   p1-telefon   İşletmemi yönet on the owner's phone (made ready last: from then on the owner's sign-in asks for a code).
 *
 *   npx tsx scripts/sosyal/youtube-rapor-kayit.ts            (needs `npm run build`; ~25 minutes)
 *   RAPOR_HIZLI=1 …                                           a quick rehearsal (5 days of history, 3 tables a day)
 *
 * No pointer: every tap goes through Recorder.tap (box saved, a still lead-in the edit cuts). Mola window 1280×800 (2×), phone
 * 390×844 (3×). Ports: café 3798, Mola Merkez 3799. Every process is stopped at the end.
 * Output: .local/sosyal/youtube/rapor/kayit/<klip>/ (meta.json), kayit/bilgi.json (the figures on screen, the e-mail),
 * kayit/gun-sonu-raporu.pdf (the e-mail's attachment) and kayit/kapak-telefon.png (the phone, for the thumbnail).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { DEMO_RECIPES, DEMO_STOCK, DESKTOP, NO_HINTS, PHONE, ROOT, Recorder, istanbul, kit, pause, smoothScroll, typeIn, type Want } from './kayit-ortak';
import { decodeParts, fakeSmtp } from '../../tests/fake-smtp';

const BASE = join(ROOT, '.local', 'sosyal', 'youtube', 'rapor');
const OUT = join(BASE, 'kayit');
const FAST = !!process.env.RAPOR_HIZLI;
const run = join(BASE, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const k = kit({ run, kafePort: 3798, merkezPort: 3799, saat: istanbul(-4, 22, 10), gun: FAST ? 5 : 62 });
mkdirSync(OUT, { recursive: true });
const info: Record<string, unknown> = {};
const ist = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
/** The demo owner's (Serkan Yıldız) addresses: only the run's test SMTP server ever sees mail. */
const OWNER_EMAIL = 'serkan@ornekkafe.com', REPORT_TO = 'serkan@ornekkafe.com, muhasebe@ornekkafe.com', GMAIL = 'ornekkafe.rapor@gmail.com';

// ---------- The days played off camera ----------
type Visit = { table: string; at: number; lines: Want[]; method: 'cash' | 'card'; qr?: boolean; masasiz?: string };
// No Ev Yapımı Limonata (the demo's "Yeni Sezon Limonata" campaign starts on these days) and at most 3 teas a table (its
// "Çay Keyfi: 4 çay ve üzeri" campaign): the waiter's order is sent with the menu price (Kit.order).
const DRINKS: [string, number][] = [['Demleme Çay', 6], ['Türk Kahvesi', 5], ['Caffè Latte', 5], ['Americano', 3], ['Ihlamur', 1], ['Ayran', 2]];
const DESSERTS: [string, number][] = [['San Sebastian', 4], ['Künefe', 3], ['Çikolatalı Brownie', 2], ['Fırın Sütlaç', 2], ['Fıstıklı Baklava', 2], ['Profiterol', 1], ['Kazandibi', 1]];
const NAMES = ['Ahmet', 'Elif', 'Can', 'Selin', 'Murat'];
/**
 * One day's tables (seeded: the same day every run): by default every 40–50 minutes from 08:40, 2–5 people, a drink each and
 * some desserts. A visit is paid 35 minutes after its order (Kit.serveDay), so the gap is never under 36 minutes.
 */
function dayPlan(seed: number, count: number, o: { start?: number; gap?: [number, number]; people?: [number, number] } = {}): Visit[] {
  const [g0, g1] = o.gap ?? [40, 50], [p0, p1] = o.people ?? [2, 5];
  let x = seed;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const pick = (list: [string, number][]) => { let r = rnd() * list.reduce((n, [, w]) => n + w, 0); for (const [name, w] of list) if ((r -= w) < 0) return name; return list[0][0]; };
  const visits: Visit[] = [];
  let at = o.start ?? 8 * 60 + 40;
  for (let i = 0; i < count; i++) {
    const people = p0 + Math.floor(rnd() * (p1 - p0 + 1)), lines = new Map<string, number>();
    for (let p = 0; p < people; p++) { let d = pick(DRINKS); if (d === 'Demleme Çay' && (lines.get(d) ?? 0) >= 3) d = 'Türk Kahvesi'; lines.set(d, (lines.get(d) ?? 0) + 1); if (rnd() < .55) { const s = pick(DESSERTS); lines.set(s, (lines.get(s) ?? 0) + 1); } }
    const kind = rnd(), masasiz = kind < .1, qr = !masasiz && kind < .45;
    visits.push({ table: `Masa ${String(1 + (i * 5) % 16).padStart(2, '0')}`, at, lines: [...lines].map(([name, n]) => [name, masasiz ? Math.min(n, 2) : n] as Want),
      method: rnd() < .62 ? 'card' : 'cash', ...(qr ? { qr: true } : {}), ...(masasiz ? { masasiz: rnd() < .5 ? NAMES[i % NAMES.length] : '' } : {}) });
    at += g0 + Math.floor(rnd() * (g1 - g0 + 1));
  }
  return visits;
}
/** Cash expenses the cashier writes (after the visit of that index): TL, description. */
const EXPENSES: Record<number, [number, number, string][]> = {
  [-3]: [[2, 1650, 'Süt (40 litre)'], [9, 480, 'Buz (10 torba)']],
  [-2]: [[3, 720, 'Kahvaltı ekmeği ve simit']],
  [-1]: [[4, 875, 'Temizlik malzemesi']],
  0: [[2, 1700, 'Süt (40 litre)']],
};
/** The cashier's count at each gün sonu, from the expected cash (kuruş): −₺20, exact, +₺10, −₺15. */
const COUNTS: Record<number, number> = { [-3]: -2000, [-2]: 0, [-1]: 1000, 0: -1500 };
/** The two recipes video 02 writes on camera, here written before (Kârlılık has the drinks' and the cake's cost). */
const MORE_RECIPES = [
  { product: 'Caffè Latte', items: [['Espresso çekirdeği', 18], ['Süt', 200]] as [string, number][], options: [{ group: 'Boy', option: 'Büyük', scale: 1.5 }] },
  { product: 'San Sebastian', items: [['Krem peynir', 100], ['Yumurta', 1], ['Krema', 25], ['Şeker', 20]] as [string, number][] },
];

// ---------- On the screens ----------
const dialog = (page: Page) => page.getByRole('dialog').last();
const nav = (page: Page, name: string) => page.locator('aside nav').getByRole('button', { name: new RegExp(`^${name}`) });
const period = (page: Page, name: string) => page.locator('.period-pills').getByRole('button', { name, exact: true }).first();
const sentence = (page: Page) => page.locator('.simple-sentence').first();
/** Scrolls so that `target` stands `at` px below the top of the window. */
async function bring(page: Page, target: Locator, at: number, ms = 1000) {
  const y = await target.evaluate((e, a) => e.getBoundingClientRect().top - a, at);
  if (Math.abs(y) > 4) { await smoothScroll(page, Math.round(y), ms); await pause(page, 500); }
}
/** Scrolls the open window (a dialog) so that `target` stands `at` px below the dialog's top. */
async function bringIn(page: Page, target: Locator, at: number) {
  await target.evaluate((e, a) => {
    const box = e.closest('dialog') as HTMLElement | null; if (!box) return;
    box.scrollBy({ top: e.getBoundingClientRect().top - box.getBoundingClientRect().top - a, behavior: 'smooth' });
  }, at);
  await pause(page, 1000);
}
const toTop = async (page: Page) => { await page.evaluate('scrollTo({ top: 0, behavior: "smooth" })'); await pause(page, 900); };
/** Waits until a text on screen is no longer what it was (a new period's figures). */
async function changed(target: Locator, before: string) {
  await target.page().waitForFunction(([el, b]) => !!el && (el as HTMLElement).innerText !== b, [await target.elementHandle(), before] as const, { timeout: 20000 }).catch(() => {});
  await pause(target.page(), 500);
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
    const ownerPost = async (path: string, body: unknown) => { const api = await k.ownerApi(desk); try { return await k.post(api.req, path, body); } finally { await api.close(); } };

    // ===== Four days ago, evening (off camera): the POS rate empty (a new café's default), Stok set up =====
    { const api = await k.ownerApi(desk), s = await k.state(api.req);
      await k.post(api.req, '/api/staff/settings', { sector: s.sector ?? 'cafe', paymentMode: s.paymentMode ?? 'after_service', cleaningEnabled: s.cleaningEnabled ?? false, waiterApproval: false, changeSeconds: s.changeSeconds ?? 0, commissionBps: null });
      await api.close(); }
    // Shelves for the whole run (no "… azaldı" notification comes up during the clips).
    await k.setUpStock(DEMO_STOCK.map(i => ({ ...i, initial: i.initial * 12 })), [...DEMO_RECIPES, ...MORE_RECIPES]);

    /** A day of the café (off camera): the kasa opened, the tables (the waiter's tablet on: QR orders need a staff screen), the gün sonu. */
    let drawer = 50000;  // what the last gün sonu left in the drawer: the next opening counts it
    async function liveDay(day: number, visits: Visit[], o: { open?: boolean; close?: boolean; from?: number } = {}) {
      await k.setClock(istanbul(day, Math.floor((o.from ?? 8 * 60 + 25) / 60), (o.from ?? 8 * 60 + 25) % 60));
      const waiter = await k.staffScreen('garson', 'tablet');
      if (o.open !== false) await k.openKasa(drawer);
      for (const [i, v] of visits.entries()) {
        await k.serveDay([v], day);
        for (const [after, tl, text] of FAST ? [] : EXPENSES[day] ?? []) if (after === i) { const c = await k.as('kasiyer'); await k.post(c.req, '/api/staff/expenses', { requestId: randomUUID(), amount: tl * 100, description: text }); await c.close(); }
      }
      if (o.close) {
        await k.setClock(istanbul(day, 22, 45));
        const offset = COUNTS[day] ?? 0, expected = await k.closeKasa({ count: e => Math.max(0, e + offset) });
        drawer = Math.min(50000, Math.max(0, (expected ?? 0) + offset));
        console.log(`  Gün ${day}: ${visits.length} masa, beklenen ${expected}, fark ${offset}`);
      }
      await waiter.ctx.close();
    }
    const n = (full: number) => FAST ? 3 : full;
    await liveDay(-3, dayPlan(15, n(16)), { close: true });
    await liveDay(-2, dayPlan(16, n(18)), { close: true });
    await liveDay(-1, dayPlan(17, n(17)), { close: true });
    // This morning, then the owner at 12:58.
    // Today and tomorrow a busier morning: tables every 36–40 minutes from 08:05, 3–6 people.
    const busy = { start: 8 * 60 + 5, gap: [36, 40] as [number, number], people: [3, 6] as [number, number] };
    const today = dayPlan(18, n(17), busy);
    // The morning paid before 12:58; the afternoon after the owner's clips (from 14:00, the POS rate set by then).
    const morning = today.filter(v => v.at < 12 * 60 + 15), evening = today.filter(v => v.at >= 14 * 60);
    await liveDay(0, morning, { from: 7 * 60 + 50 });
    await k.setClock(istanbul(0, 12, 58));
    await k.readNotifications();
    info.lunch = ist(k.now());

    /** The owner's Mola window, signed in fresh (after a jump of the clock its session would be locked). */
    async function ownerScreen() {
      const owner = await k.staffScreen('isletme', 'desktop'), op = owner.page;
      await op.addInitScript(NO_HINTS); await op.reload(); await pause(op, 1500);
      // The reload locks the sounds again: a click on the page header unlocks them (the "Ses kapalı" note goes away).
      await op.mouse.click(640, 20); await pause(op, 500);
      const sound = op.getByText(/Ses kapalı/).first();
      if (await sound.isVisible().catch(() => false)) { await sound.click(); await pause(op, 500); }
      return owner;
    }
    let owner = await ownerScreen(), op = owner.page;
    const reports = () => op.locator('aside nav').getByRole('button', { name: 'Satış ve Raporlar', exact: true });

    // ===== r1: today's plain summary =====
    console.log('Kayıt: r1-bugun');
    { const rec = new Recorder(op, join(OUT, 'r1-bugun'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', reports(), { hold: 1600 });
      await sentence(op).waitFor({ timeout: 20000 }); await op.locator('.simple-grid').waitFor(); await pause(op, 700);
      rec.mark('report');
      await rec.look(op, 'sentence', sentence(op), 3800);
      await rec.box('grid', op.locator('.simple-grid'));
      await rec.look(op, 'grid', op.locator('.simple-grid'), 4200);
      await rec.look(op, 'kept', op.locator('.simple-kept'), 3200);
      await bring(op, op.locator('.simple-pair'), 250);
      rec.mark('pair');
      await rec.look(op, 'pair', op.locator('.simple-pair'), 4000);
      await rec.stop();
      info.todaySentence = await sentence(op).innerText();
      info.todayGrid = await op.locator('.simple-grid').innerText();
      info.todayPair = await op.locator('.simple-pair').innerText(); }

    // ===== r2: the periods and their comparison =====
    console.log('Kayıt: r2-donem');
    await toTop(op);
    { const rec = new Recorder(op, join(OUT, 'r2-donem'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      let before = await sentence(op).innerText();
      await rec.tap(op, 'd7', period(op, '7 gün'), { hold: 400 });
      await changed(sentence(op), before); rec.mark('week');
      await rec.look(op, 's7', sentence(op), 4000);
      info.weekSentence = before = await sentence(op).innerText();
      await rec.tap(op, 'd30', period(op, '30 gün'), { hold: 400 });
      await changed(sentence(op), before); rec.mark('month');
      await rec.look(op, 's30', sentence(op), 4000);
      await rec.look(op, 'grid30', op.locator('.simple-grid'), 3000);
      info.monthSentence = before = await sentence(op).innerText();
      info.monthGrid = await op.locator('.simple-grid').innerText();
      await rec.tap(op, 'year', op.locator('.period-year > button'), { hold: 400 });
      await changed(sentence(op), before); rec.mark('year');
      await rec.look(op, 'yearMenu', op.locator('.period-year-menu'), 3600);
      info.yearSentence = await sentence(op).innerText();
      before = info.yearSentence as string;
      await rec.tap(op, 'back30', period(op, '30 gün'), { hold: 400 });
      await changed(sentence(op), before); await pause(op, 900);
      await rec.stop(); }

    // ===== r3: the detailed Özet of 30 gün =====
    console.log('Kayıt: r3-detay');
    { const rec = new Recorder(op, join(OUT, 'r3-detay'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await bring(op, op.locator('.simple-detail-btn'), 520);
      await rec.tap(op, 'detail', op.locator('.simple-detail-btn'), { hold: 300 });
      await op.locator('.kpi-row').first().waitFor({ timeout: 20000 }); await toTop(op); await pause(op, 800);
      rec.mark('detail');
      await rec.look(op, 'kpi', op.locator('.kpi-row').first(), 4200);
      info.kpi = await op.locator('.kpi-row').first().innerText();
      await bring(op, op.locator('.daily-card'), 110);
      rec.mark('chart');
      await rec.look(op, 'chart', op.locator('.daily-card'), 3800);
      const channels = op.locator('.channel-card');
      if (await channels.count()) { await bring(op, channels, 200); rec.mark('channels'); await rec.look(op, 'channels', channels, 3800); info.channels = await channels.innerText(); }
      const vat = op.locator('.vat-panel');
      if (await vat.count()) { await bring(op, vat, 260); rec.mark('vat'); await rec.look(op, 'vat', vat, 3600); info.vat = await vat.innerText(); }
      await rec.stop(); }

    // ===== r4: Ürünler =====
    console.log('Kayıt: r4-urunler');
    await toTop(op);
    { const rec = new Recorder(op, join(OUT, 'r4-urunler'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'tab', op.locator('[data-report-tab="products"]'), { hold: 1600 });
      await op.locator('.product-table table').waitFor({ timeout: 20000 }); await pause(op, 500);
      rec.mark('table');
      await rec.look(op, 'table', op.locator('.product-table'), 4200);
      await rec.tap(op, 'cat', op.locator('.category-pills').getByRole('button', { name: 'Tatlılar', exact: true }), { hold: 1500 });
      rec.mark('desserts');
      await rec.look(op, 'desserts', op.locator('.product-table'), 3200);
      info.products = await op.locator('.product-table').innerText();
      await rec.stop(); }

    // ===== r5: Personel → Çalışanlar: the QR share =====
    console.log('Kayıt: r5-personel');
    await toTop(op);
    { const rec = new Recorder(op, join(OUT, 'r5-personel'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'group', op.locator('[data-report-group="people"]'), { hold: 1600 });
      const qr = op.locator('.self-service-report');
      await qr.waitFor({ timeout: 20000 }); await pause(op, 600);
      rec.mark('people');
      await rec.box('qr', qr);
      await rec.look(op, 'qr', qr, 5200);
      await rec.look(op, 'staff', op.locator('.employee-distribution').nth(1), 3400);
      info.qr = await qr.innerText();
      info.staff = await op.locator('.employee-distribution').nth(1).innerText();
      await rec.stop(); }

    // ===== r6: Kârlılık, one glance =====
    console.log('Kayıt: r6-karlilik');
    await toTop(op);
    { const rec = new Recorder(op, join(OUT, 'r6-karlilik'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'group', op.locator('[data-report-group="sales"]'), { hold: 1200 });
      await rec.tap(op, 'tab', op.locator('[data-report-tab="profit"]'), { hold: 1200 });
      await rec.tap(op, 'today', period(op, 'Bugün'), { hold: 1400 });
      await op.locator('.kpi-row').first().waitFor({ timeout: 20000 }); await pause(op, 600);
      rec.mark('profit');
      await rec.look(op, 'kpi', op.locator('.kpi-row').first(), 3600);
      info.profit = await op.locator('.kpi-row').first().innerText();
      const table = op.locator('.profit-table');
      if (await table.count()) { await bring(op, table, 110, 1100); rec.mark('rows'); await rec.look(op, 'rows', table, 3000); }
      await rec.stop(); }

    // ===== r7: Kasa kapanışları =====
    console.log('Kayıt: r7-kapanis');
    await toTop(op);
    { const rec = new Recorder(op, join(OUT, 'r7-kapanis'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'nav', nav(op, 'Kasa ve giderler'), { hold: 1300 });
      await rec.tap(op, 'tab', op.locator('[data-home-tab="closings"]'), { hold: 1500 });
      await rec.tap(op, 'd7', period(op, '7 gün'), { hold: 1200 });
      await op.locator('.cash-closing-list').waitFor({ timeout: 20000 }); await pause(op, 700);
      rec.mark('list');
      await rec.look(op, 'kpis', op.locator('.cash-kpis'), 3400);
      await bring(op, op.locator('.cash-closing-list'), 150);
      await rec.look(op, 'cards', op.locator('.cash-closing-list'), 3800);
      info.closings = await op.locator('.cash-closing-list').innerText();
      const short = op.locator('.cash-closing-card', { has: op.locator('.cash-badge', { hasText: /^[−-]/ }) }).first();
      await rec.tap(op, 'open', short.locator('.cash-closing-head'), { hold: 1200 });
      rec.mark('opened');
      const lines = short.locator('section[aria-label="Kasa"]');
      await bring(op, short, 110);
      await rec.look(op, 'expected', lines, 4600);
      info.closingLines = await lines.innerText().catch(() => '');
      await rec.stop(); }

    // ===== r8: Yazdır ve paylaş: the A4 page and its PDF, the accountant's Excel =====
    console.log('Kayıt: r8-yazdir');
    await toTop(op);
    { const rec = new Recorder(op, join(OUT, 'r8-yazdir'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'nav', reports(), { hold: 1500 });
      // The reports open where they were left (Kârlılık): back to Özet, then 7 gün.
      await rec.tap(op, 'summary', op.locator('[data-report-tab="summary"]'), { hold: 1300 });
      await op.locator('.kpi-row').first().waitFor({ timeout: 20000 });
      await rec.tap(op, 'd7', period(op, '7 gün'), { hold: 1500 });
      await rec.tap(op, 'share', op.locator('.report-share-btn'), { hold: 900 });
      rec.mark('menu');
      await rec.look(op, 'menu', op.locator('.report-share-menu'), 3600);
      await rec.tap(op, 'print', op.locator('.report-share-menu').getByRole('menuitem', { name: /Yazdır \/ PDF/ }), { hold: 600 });
      const frame = dialog(op).locator('iframe.print-frame');
      await frame.waitFor({ timeout: 30000 });
      await op.frameLocator('iframe.print-frame').locator('body').waitFor(); await pause(op, 1400);
      rec.mark('preview');
      await rec.look(op, 'page', frame, 3400);
      await frame.evaluate(f => (f as HTMLIFrameElement).contentWindow?.scrollBy({ top: 520, behavior: 'smooth' })); await pause(op, 1300);
      rec.mark('pageDown');
      await rec.look(op, 'page2', frame, 3000);
      const download = op.waitForEvent('download', { timeout: 90000 });
      await rec.tap(op, 'pdf', dialog(op).getByRole('button', { name: 'PDF indir' }), { hold: 300 });
      const pdf = await download; await pdf.saveAs(join(OUT, 'yazdir.pdf')).catch(() => {});
      const pdfNote = dialog(op).locator('.notice').last();
      await pdfNote.waitFor({ timeout: 30000 }); await pause(op, 400);
      rec.mark('pdfNote');
      await rec.look(op, 'pdfNote', pdfNote, 2600);
      info.pdfNote = await pdfNote.innerText();
      await rec.tap(op, 'closePrint', dialog(op).getByRole('button', { name: 'Kapat', exact: true }).last(), { hold: 900 });
      await rec.tap(op, 'share2', op.locator('.report-share-btn'), { hold: 900 });
      await rec.tap(op, 'excel', op.locator('.report-share-menu').getByRole('menuitem', { name: /Muhasebeci için indir/ }), { hold: 1300 });
      rec.mark('excel');
      await rec.look(op, 'choices', dialog(op).locator('.export-choices'), 3400);
      const xlsx = op.waitForEvent('download', { timeout: 90000 });
      await rec.tap(op, 'xlsx', dialog(op).getByRole('button', { name: /Excel dosyasını indir/ }), { hold: 300 });
      await (await xlsx).saveAs(join(OUT, 'muhasebe.xlsx')).catch(() => {});
      const xNote = dialog(op).locator('.notice').last();
      await xNote.waitFor({ timeout: 30000 }); await pause(op, 400);
      rec.mark('xlsxNote');
      await rec.look(op, 'xlsxNote', xNote, 2800);
      info.xlsxNote = await xNote.innerText();
      await rec.tap(op, 'closeExcel', dialog(op).getByRole('button', { name: 'Kapat', exact: true }).last(), { hold: 900 });
      await rec.stop(); }

    // ===== s1: the setting: POS komisyon oranı =====
    console.log('Kayıt: s1-pos');
    await toTop(op);
    { const rec = new Recorder(op, join(OUT, 's1-pos'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'nav', nav(op, 'Kasa ve giderler'), { hold: 1300 });
      await rec.tap(op, 'tab', op.locator('[data-home-tab="settings"]'), { hold: 1300 });
      await rec.tap(op, 'part', op.locator('[data-part="card"]'), { hold: 1500 });
      const field = op.getByLabel('POS komisyon oranı (%)', { exact: true });
      await field.waitFor({ timeout: 20000 }); await pause(op, 500);
      rec.mark('card');
      await rec.look(op, 'cardLead', op.locator('form[aria-label="Kart tahsilatı"]'), 3200);
      await typeIn(op, rec, 'rate', field, '1,75', { lead: 2000, delay: 170 });
      await pause(op, 600);
      rec.mark('typed');
      await op.keyboard.press('Enter'); await pause(op, 1500);
      await rec.look(op, 'hint', op.locator('form[aria-label="Kart tahsilatı"] .settings-row').first(), 3800);
      await rec.stop();
      info.posRow = await op.locator('form[aria-label="Kart tahsilatı"]').innerText();
      const api = await k.ownerApi(desk), s = await k.state(api.req); await api.close();
      info.commissionBps = s.commissionBps;
      if (s.commissionBps !== 175) throw new Error(`POS oranı kaydedilmedi: ${s.commissionBps}`); }

    // ===== s2: the setting: e-posta raporları (the account saved before, off camera; never contacted) =====
    await ownerPost('/api/staff/email-reports', { account: { provider: 'gmail', host: 'smtp.gmail.com', port: 465, security: 'tls', user: GMAIL, password: randomBytes(8).toString('hex') }, to: [], reports: { day: false, week: false, month: false, year: false } });
    console.log('Kayıt: s2-eposta');
    await toTop(op);
    { const rec = new Recorder(op, join(OUT, 's2-eposta'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'nav', reports(), { hold: 1500 });
      await rec.tap(op, 'share', op.locator('.report-share-btn'), { hold: 900 });
      await rec.tap(op, 'send', op.locator('.report-share-menu').getByRole('menuitem', { name: /Raporları gönder/ }), { lead: 2000, hold: 1500 });
      const d = dialog(op);
      await d.locator('.email-reports-form').waitFor({ timeout: 20000 }); await pause(op, 600);
      rec.mark('modal');
      await rec.look(op, 'account', d.locator('.email-reports-form'), 3600);
      // Pasted at once: typed letter by letter, the half-written address reads "Adres geçersiz" for a moment.
      const to = d.getByLabel('Raporların gideceği adresler');
      await rec.tap(op, 'to', to, { lead: 700, hold: 400 });
      await to.fill(REPORT_TO);
      await pause(op, 600);
      await rec.tap(op, 'save', d.getByRole('button', { name: /Değişiklikleri kaydet|Hesabı kaydet/ }), { hold: 300 });
      await d.locator('.notice-success').waitFor({ timeout: 20000 }); await pause(op, 500);
      rec.mark('saved');
      await rec.look(op, 'savedNote', d.locator('.notice-success'), 2600);
      const which = d.locator('.settings-card', { hasText: 'Hangi raporlar gelsin?' });
      await bringIn(op, which, 20);
      rec.mark('which');
      await rec.look(op, 'which', which, 2600);
      for (const [name, label] of [['day', 'Gün sonu raporu'], ['week', 'Haftalık rapor'], ['month', 'Aylık rapor']] as const) {
        await rec.tap(op, name, which.getByLabel(label, { exact: true }), { lead: 900, hold: 1100 });
      }
      rec.mark('on');
      await rec.look(op, 'switches', which, 3200);
      const facts = d.locator('.settings-card', { hasText: 'Raporda neler var?' });
      await bringIn(op, facts, 20);
      rec.mark('facts');
      await rec.look(op, 'facts', facts, 4200);
      await rec.tap(op, 'close', d.getByRole('button', { name: 'Kapat' }).first(), { hold: 900 });
      await rec.stop(); }
    { const api = await k.ownerApi(desk); info.emailView = await (await api.req.get(`${k.KAFE}/api/staff/email-reports`)).json(); await api.close(); }
    await owner.ctx.close();

    // ===== The afternoon and the gün sonu (off camera): the day report by e-mail to the test SMTP server =====
    await ownerPost('/api/staff/email-reports', { account: { provider: 'other', host: '127.0.0.1', port: smtp.port, security: 'none', user: '', from: GMAIL } });
    await liveDay(0, evening, { open: false, close: true, from: 13 * 60 + 50 });
    for (let i = 0; i < 180 && !smtp.received.length; i++) await new Promise(r => setTimeout(r, 1000));
    const mail = smtp.received.at(-1);
    if (!mail) throw new Error('Gün sonu raporu e-postası gelmedi.');
    const parts = decodeParts(mail.data), pdfPart = parts.find(p => p.name?.endsWith('.pdf'));
    info.mail = { to: mail.to, subject: /Subject: ([^\n]+)/.exec(mail.data)?.[1], files: parts.filter(p => p.name).map(p => p.name), text: parts.find(p => !p.name && p.type === 'text/plain')?.text.slice(0, 1500) };
    if (pdfPart) writeFileSync(join(OUT, 'gun-sonu-raporu.pdf'), pdfPart.bytes);
    // The account shown on camera back again (the sent report stays in its list).
    await ownerPost('/api/staff/email-reports', { account: { provider: 'gmail', host: 'smtp.gmail.com', port: 465, security: 'tls', user: GMAIL, password: randomBytes(8).toString('hex') } });

    // ===== The next day (off camera): the morning's tables, all card payments with their commission =====
    const next = dayPlan(19, n(17), busy).filter(v => v.at < 11 * 60 + 50);
    await liveDay(1, next, { from: 7 * 60 + 50 });
    await k.setClock(istanbul(1, 12, 30));
    await k.readNotifications();
    owner = await ownerScreen(); op = owner.page;

    // ===== s3: today's plain summary with the card commission =====
    console.log('Kayıt: s3-sonra');
    { const rec = new Recorder(op, join(OUT, 's3-sonra'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', reports(), { hold: 1600 });
      await sentence(op).waitFor({ timeout: 20000 }); await op.locator('.simple-grid').waitFor(); await pause(op, 700);
      rec.mark('report');
      await rec.box('grid', op.locator('.simple-grid'));
      await rec.look(op, 'grid', op.locator('.simple-grid'), 3600);
      await rec.look(op, 'kept', op.locator('.simple-kept'), 3000);
      await rec.tap(op, 'tip', op.locator('.simple-kept .simple-tip-dot'), { hold: 900 });
      const pop = op.locator('.simple-kept .simple-tip-pop');
      await pop.waitFor({ timeout: 10000 }); rec.mark('tip');
      await rec.look(op, 'breakdown', pop, 4600);
      info.nextGrid = await op.locator('.simple-grid').innerText();
      info.keptTip = await pop.innerText();
      await op.keyboard.press('Escape'); await pause(op, 600);
      await rec.stop(); }

    // ===== s4: what arrived: Bildirimler, Son raporlar =====
    console.log('Kayıt: s4-gelen');
    await toTop(op);
    { const rec = new Recorder(op, join(OUT, 's4-gelen'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'bell', op.getByRole('button', { name: /^Bildirimler/ }).first(), { hold: 1500 });
      const item = op.locator('.notification-item.report').first();
      await item.waitFor({ timeout: 20000 }); await pause(op, 500);
      rec.mark('inbox');
      await rec.look(op, 'report', item, 4600);
      info.notification = await item.innerText();
      await rec.tap(op, 'nav', reports(), { hold: 1400 });
      await rec.tap(op, 'share', op.locator('.report-share-btn'), { hold: 900 });
      await rec.tap(op, 'send', op.locator('.report-share-menu').getByRole('menuitem', { name: /Raporları gönder/ }), { hold: 1500 });
      const d = dialog(op), list = d.locator('.email-reports-recent');
      await list.waitFor({ timeout: 20000 });
      await bringIn(op, d.locator('.email-reports-status'), 120);
      rec.mark('sent');
      await rec.look(op, 'recent', d.locator('.settings-card', { hasText: 'Hangi raporlar gelsin?' }), 4600);
      info.recent = await list.innerText();
      await rec.tap(op, 'close', d.getByRole('button', { name: 'Kapat' }).first(), { hold: 900 });
      await rec.stop(); }
    await owner.ctx.close();

    // ===== p1: İşletmemi yönet on the owner's phone. Last: from here on the owner's sign-in asks for the phone code. =====
    const remote = await k.ownerRemote({ email: OWNER_EMAIL });
    console.log('Kayıt: p1-telefon');
    { const { ctx: tctx, page: tel, hero } = await k.ownerPhone(remote, OWNER_EMAIL);
      await pause(tel, 2500); await tel.evaluate('scrollTo(0, 0)'); await pause(tel, 600);
      await tel.screenshot({ path: join(OUT, 'kapak-telefon.png') });
      const rec = new Recorder(tel, join(OUT, 'p1-telefon'), PHONE);
      await rec.start(); await pause(tel, 1200);
      await rec.look(tel, 'hero', hero, 3600);
      const closing = tel.getByRole('region', { name: 'Son kasa kapanışı' });
      await bring(tel, closing, 90, 1600);
      rec.mark('closing');
      await rec.look(tel, 'closing', closing, 3200);
      const month = tel.getByRole('region', { name: 'Son 30 gün' });
      await bring(tel, month, 90, 1400);
      rec.mark('month');
      await rec.look(tel, 'month', month, 3400);
      await rec.stop();
      info.phone = await hero.innerText().catch(() => '');
      info.phoneClosing = await closing.innerText().catch(() => '');
      await tctx.close(); }
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
