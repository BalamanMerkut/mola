/*
 * YouTube 04 "Kampanyalar ve rezervasyon" (introduction series): recordings of the REAL app for one linear story (edit:
 * scripts/sosyal/youtube-kampanya-kurgu.ts). One run in story order on a fresh Mola Merkez + demo café ("Mola Örnek Kafe",
 * shared parts: scripts/sosyal/kayit-ortak.ts) in .local/sosyal/youtube/kampanya/run-<zaman>/.
 *
 * The run plays on the recording clock (kit({ saat, gun })): the demo café is made with 30 days of history up to yesterday
 * evening (the campaign report compares with the weeks before). This morning's tables are served off camera, then:
 *
 *   c1-kampanya  13:05 the owner: Menü yönetimi → Kampanyalar (the states, the demo's campaigns) → "Kampanya ekle":
 *                "İkindi kahvesi", the kinds looked at (X al Y öde, İkincisi indirimli), Yüzde indirim %20, "Bütün bir bölüm"
 *                → Kahveler, "Her hafta" Pazartesi–Cuma, "Saat aralığı ekle" (14:00–17:00), "Toplam adet sınırı" 30,
 *                "Müşteri menüde böyle görür" → "Kampanyayı kaydet" (Planlandı).
 *   c2-hediye    "Kampanya ekle": "Tatlı yanına Türk kahvesi", Hediye ürün: Tatlılarda 2 adet alana Türk Kahvesi bedava.
 *   g0-once      13:40 the guest's phone at Masa 07 (only for the before / after split): Kahveler at the menu price.
 *   g1-misafir   15:00 the same phone: "Kampanyalı ürünler" (the strip "Kahvelerde %20 indirim · 30 adet kaldı"), Kahveler with
 *                the crossed-out prices, Caffè Latte's window.
 *   t1-garson    15:05 the waiter's tablet: Masa 04 → "Sipariş ekle" → 2 Caffè Latte (campaign price), 2 San Sebastian → the
 *                hint "Kampanya: Türk Kahvesi bedava · Ekle" → the basket (campaign discount) → "Siparişi gönder".
 *   k1-kasa      15:40 the counter: Masa 04's window (the lines with their campaigns, the gift −₺) → "Ödeme al" → Kart.
 *   o1-bitti     16:40 the owner (the afternoon's coffees off camera): the last coffees use up the 30 → "Kampanya bitti"
 *                (Adet sınırı doldu, the figures) → "Raporu aç" → Satış ve Raporlar → Kampanyalar.
 *   r1-rezerv    17:25 Ajanda ve rezervasyon → Rezervasyonlar → 19:30 → Masa 05: Ayşe Yılmaz, 4 kişi, "Doğum günü",
 *                "Kapora alındı" ₺500 Nakit → "Kaydet" (the tile "Rezerve 19:30", the day's list).
 *   t2-once      18:35 the tablet's Masalar (only for the split): Masa 05 still an ordinary table (held 30 minutes before).
 *   s1-ayar      the setting: Ajanda ve rezervasyon → Ayarlar → "Rezervasyondan kaç dakika önce masa ayrılsın" → 1 saat önce.
 *   t3-sonra     the tablet's Masalar: Masa 05 "Rezerve · Ayşe Yılmaz · 4 kişi · 19:30", "QR kapalı · 19:30 rezervasyonu".
 *   g2-rezerve   the guest's phone at Masa 05: "Bu masa 19:30 için ayrılmıştır…".
 *   t4-geldi     19:20 the tablet: Masa 05 → "Geldi" → the guest's name on the table; the order (off camera) → the table's
 *                window: the kapora taken off the bill.
 *   e1-etkinlik  19:40 the owner: Ajanda ve rezervasyon → Etkinlikler → "Etkinlik oluştur": Elazığspor derbisi, tomorrow
 *                20:30–22:30, 12 geçici masa (D1…D12), 4 kişi → "Etkinliği oluştur".
 * Off camera: three reservations on the event's tables (one with ₺1.000 kapora), tonight's bills, the gün sonu; tomorrow the
 * kasa opened, at 20:30 the event starts by itself, two guests seated, walk-ins named, orders.
 *   t5-etkinlik  tomorrow 20:55 the tablet's Masalar: the section "Etkinlik: Elazığspor derbisi" with its tables.
 *   e2-kapat     tomorrow 22:50 (every bill closed off camera): Etkinlikler → "Etkinliği kapat" (the guest who did not come is
 *                marked) → "Rezervasyon raporu" → Satış ve Raporlar → Rezervasyon, 7 gün: the reservations, kapora, the event.
 *
 *   npx tsx scripts/sosyal/youtube-kampanya-kayit.ts            (needs `npm run build`; ~25 minutes)
 *   KAMPANYA_HIZLI=1 …                                           a quick rehearsal (5 days of history)
 *
 * No pointer: every tap goes through Recorder.tap (box saved, a still lead-in the edit cuts). Mola window 1280×800 (2×), waiter's
 * tablet 1180×820 (2×), phone 390×844 (3×). Ports: café 3786, Mola Merkez 3787. Every process is stopped at the end.
 * Output: .local/sosyal/youtube/kampanya/kayit/<klip>/ (meta.json), kayit/bilgi.json (the figures on screen) and
 * kayit/kapak-telefon.png (the guest's Kahveler with the campaign, for the thumbnail).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { DESKTOP, PHONE, ROOT, Recorder, TABLET, bring, bringIn, choose, dialog, istanbul, kit, nav, pause, retype, smoothScroll, tableCard, typeIn, type Want } from './kayit-ortak';

const BASE = join(ROOT, '.local', 'sosyal', 'youtube', 'kampanya');
const OUT = join(BASE, 'kayit');
const FAST = !!process.env.KAMPANYA_HIZLI;
const run = join(BASE, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const k = kit({ run, kafePort: 3786, merkezPort: 3787, saat: istanbul(-1, 22, 10), gun: FAST ? 5 : 30 });
mkdirSync(OUT, { recursive: true });
const info: Record<string, unknown> = {};
const ist = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

/** The campaign of the story and its quota; the coffees that use it up at the end are ordered while the owner looks. */
const CAMPAIGN = 'İkindi kahvesi', QUOTA = 30, LAST = 3;
const GIFT = 'Tatlı yanına Türk kahvesi';
/** The event of tomorrow evening. */
const EVENT = 'Elazığspor derbisi';
/** This morning's tables (off camera): ordered at their minute, made, served and paid 35 minutes later. */
const MORNING: { table: string; at: number; lines: Want[]; method: 'cash' | 'card' }[] = [
  { table: 'Masa 02', at: 8 * 60 + 50, lines: [['Türk Kahvesi', 2], ['Demleme Çay', 2]], method: 'cash' },
  { table: 'Masa 06', at: 9 * 60 + 40, lines: [['Caffè Latte', 2], ['San Sebastian', 1]], method: 'card' },
  { table: 'Masa 09', at: 10 * 60 + 30, lines: [['Americano', 2], ['Künefe', 1]], method: 'card' },
  { table: 'Masa 11', at: 11 * 60 + 20, lines: [['Ev Yapımı Limonata', 2], ['Çikolatalı Brownie', 1]], method: 'card' },
  { table: 'Masa 03', at: 12 * 60 + 10, lines: [['Demleme Çay', 3], ['Ihlamur', 1], ['Fırın Sütlaç', 1]], method: 'cash' },
];
/** The afternoon's coffee rounds (off camera), as many as the quota allows; at most one dessert a table. */
const ROUNDS: Want[][] = [
  [['Türk Kahvesi', 2], ['Caffè Latte', 1], ['Americano', 1], ['Fırın Sütlaç', 1]],
  [['Caffè Latte', 2], ['Americano', 2]],
  [['Türk Kahvesi', 3], ['Ev Yapımı Limonata', 1]],
  [['Americano', 2], ['Caffè Latte', 2], ['Künefe', 1]],
  [['Türk Kahvesi', 2], ['Caffè Latte', 2]],
  [['Caffè Latte', 3], ['Demleme Çay', 1]],
  [['Americano', 2], ['Türk Kahvesi', 2]],
  [['Caffè Latte', 2], ['Türk Kahvesi', 2]],
];
const COFFEES = ['Caffè Latte', 'Americano', 'Türk Kahvesi'];

// ---------- On the screens ----------
const step = (d: Locator, title: string) => d.locator(`section.step-card[aria-label="${title}"]`);
const tile = (page: Page, table: string) => page.locator(`.plan-cell[data-table="${table}"] .plan-tile`).first();
const agendaPart = (page: Page, name: string) => page.locator('.agenda-parts').getByRole('button', { name, exact: true });
/** `n` pieces of a product on the staff menu: its card, "Adedi artır", "Sepete ekle" (the required choices keep their first). */
async function addPieces(page: Page, rec: Recorder, name: string, n: number, key: string) {
  await rec.tap(page, `${key}-card`, page.locator('.staff-card', { has: page.locator('.staff-card-name', { hasText: new RegExp(`^${name}$`) }) }).first(), { lead: 700, hold: 1000 });
  const dlg = page.getByRole('dialog').last();
  for (let i = 1; i < n; i++) await rec.tap(page, `${key}-more${i}`, dlg.getByRole('button', { name: 'Adedi artır' }), { lead: 400, hold: 500 });
  await rec.tap(page, `${key}-add`, dlg.getByRole('button', { name: /Sepete ekle/ }), { lead: 600, hold: 900 });
}
const toTop = async (page: Page) => { await page.evaluate('scrollTo({ top: 0, behavior: "smooth" })'); await pause(page, 900); };
/** The field inside a form label (a date or time field: the text input, never the browser's own picker). */
const fieldOf = (scope: Locator, label: RegExp) => scope.locator('label', { hasText: label }).locator('input:not([type=date]):not([type=hidden])').first();

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
    type CampaignRow = { id: string; name: string; usedQuantity: number; remainingQuantity: number | null };
    const campaignOf = async (name: string) => (await get<{ campaigns: CampaignRow[] }>('/api/staff/campaigns')).campaigns.find(c => c.name === name);
    const tokenOf = (table: string) => owner(async req => (await k.state(req)).tables.find(t => t.name === table)!.token);
    // The demo's campaigns on products kept off this menu (no photo) are deleted off camera: the list shows only what the guest can see.
    { const list = await get<{ campaigns: { id: string; name: string; productIds: string[] }[]; revision: number }>('/api/staff/campaigns');
      const shown = new Set((await get<{ products: { id: string; published?: boolean }[] }>('/api/staff/state')).products.filter(p => p.published !== false).map(p => p.id));
      let revision = list.revision;
      for (const c of list.campaigns.filter(c => c.productIds.length && !c.productIds.some(id => shown.has(id)))) {
        try { const r = await owner(req => k.post(req, '/api/staff/catalog/remove', { kind: 'campaign', id: c.id, revision, requestId: randomUUID() })) as { revision?: number }; revision = r.revision ?? (await get<{ revision: number }>('/api/staff/campaigns')).revision; console.log(`Kampanya silindi: ${c.name}`); }
        catch (e) { console.warn(`Kampanya silinemedi: ${c.name}: ${(e as Error).message}`); revision = (await get<{ revision: number }>('/api/staff/campaigns')).revision; }
      } }
    info.prices = Object.fromEntries((await get<{ products: { name: string; price: number; published?: boolean }[] }>('/api/staff/state')).products.filter(p => p.published !== false).map(p => [p.name, p.price / 100]));

    // ===== This morning (off camera): the kasa opened, the morning's tables =====
    await k.setClock(istanbul(0, 8, 20));
    await k.openKasa(50000);
    await k.serveDay(FAST ? MORNING.slice(0, 2) : MORNING);
    await k.setClock(istanbul(0, 13, 5));
    await k.readNotifications();
    let tablet = await k.staffScreen('garson', 'tablet');

    // ===== c1: Kampanyalar → a new campaign: İkindi kahvesi =====
    let w = await k.ownerWindow(), op = w.page;
    console.log('Kayıt: c1-kampanya');
    { const rec = new Recorder(op, join(OUT, 'c1-kampanya'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', nav(op, 'Menü yönetimi'), { hold: 1300 });
      await rec.tap(op, 'tab', op.locator('[data-home-tab="campaigns"]'), { hold: 1500 });
      await op.locator('.campaign-states').waitFor({ timeout: 20000 });
      rec.mark('list');
      await rec.look(op, 'states', op.locator('.campaign-states'), 3000);
      await rec.look(op, 'cards', op.locator('.campaign-card-grid').first(), 2200);
      info.campaignsBefore = await op.locator('.campaign-card-grid').first().innerText();
      await rec.tap(op, 'add', op.getByRole('button', { name: 'Kampanya ekle' }), { hold: 1400 });
      const d = dialog(op);
      await d.locator('.campaign-editor-form').waitFor({ timeout: 20000 });
      rec.mark('form');
      await typeIn(op, rec, 'name', d.getByLabel(/^Kampanya adı/), CAMPAIGN, { delay: 80 });
      const kind = d.getByLabel(/^Kampanya türü/);
      rec.mark('kinds');
      await choose(op, rec, 'kBuy', kind, 'X al Y öde'); await pause(op, 500);
      await choose(op, rec, 'kSecond', kind, 'İkincisi indirimli'); await pause(op, 500);
      await choose(op, rec, 'kPercent', kind, 'Yüzde indirim');
      rec.mark('percent');
      await retype(op, rec, 'percent', d.getByLabel(/^İndirim \(%\)/), '20');
      await bringIn(op, step(d, 'Hangi ürünler?'), 12);
      rec.mark('scope');
      await rec.tap(op, 'cats', d.getByRole('group', { name: 'Kampanya neye uygulansın?' }).getByRole('button', { name: 'Bütün bir bölüm' }), { hold: 900 });
      await rec.tap(op, 'kahveler', d.locator('.campaign-categories button', { hasText: 'Kahveler' }), { hold: 1200 });
      await rec.look(op, 'covered', step(d, 'Hangi ürünler?').locator('.step-result'), 2000);
      info.covered = await step(d, 'Hangi ürünler?').locator('.step-result').innerText();
      await bringIn(op, step(d, 'Ne zaman?'), 12);
      rec.mark('when');
      await rec.tap(op, 'weekly', d.getByRole('group', { name: 'Kampanya ne zaman geçerli?' }).getByRole('button', { name: 'Her hafta' }), { hold: 900 });
      for (const day of ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']) await rec.tap(op, day, d.locator('.campaign-weekdays').getByRole('button', { name: day, exact: true }), { lead: 500, hold: 250 });
      await pause(op, 600);
      await rec.tap(op, 'window', d.getByLabel('Saat aralığı ekle'), { lead: 2200, hold: 1300 });
      rec.mark('hours');
      const summary = step(d, 'Ne zaman?').locator('.campaign-schedule-summary');
      await rec.look(op, 'summary', step(d, 'Ne zaman?').locator('.step-row').first(), 2800);
      info.schedule = await summary.innerText().catch(() => '');
      await bringIn(op, step(d, 'Sınır'), 12);
      rec.mark('limit');
      await rec.tap(op, 'limitOn', d.getByLabel('Toplam adet sınırı koy'), { hold: 900 });
      await retype(op, rec, 'limit', d.getByLabel(/^Kampanya kaç adetle sınırlı/), String(QUOTA));
      rec.mark('limitSet');
      await pause(op, 1200);
      await bringIn(op, step(d, 'Durum'), 12);
      rec.mark('status');
      await rec.look(op, 'preview', d.locator('.campaign-preview'), 3200);
      info.preview = await d.locator('.campaign-preview').innerText();
      info.status = await step(d, 'Durum').innerText();
      await rec.tap(op, 'save', d.getByRole('button', { name: 'Kampanyayı kaydet' }), { hold: 300 });
      await op.locator('.campaign-editor-dialog').waitFor({ state: 'detached', timeout: 20000 });
      await pause(op, 900);
      rec.mark('saved');
      const card = op.locator('article.campaign-card', { hasText: CAMPAIGN }).first();
      await bring(op, card, 120, 1100);
      await rec.look(op, 'card', card, 2800);
      info.campaignCard = await card.innerText();
      await rec.stop(); }

    // ===== c2: a gift campaign =====
    console.log('Kayıt: c2-hediye');
    await toTop(op);
    { const rec = new Recorder(op, join(OUT, 'c2-hediye'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'add', op.getByRole('button', { name: 'Kampanya ekle' }), { hold: 1400 });
      const d = dialog(op);
      await d.locator('.campaign-editor-form').waitFor({ timeout: 20000 });
      rec.mark('form');
      await typeIn(op, rec, 'name', d.getByLabel(/^Kampanya adı/), GIFT, { delay: 70 });
      await bringIn(op, step(d, 'Hangi ürünler?'), 12);
      rec.mark('scope');
      await rec.tap(op, 'cats', d.getByRole('group', { name: 'Kampanya neye uygulansın?' }).getByRole('button', { name: 'Bütün bir bölüm' }), { hold: 900 });
      await rec.tap(op, 'tatlilar', d.locator('.campaign-categories button', { hasText: 'Tatlılar' }), { hold: 1200 });
      await bringIn(op, step(d, 'Ne indirimi?'), 12);
      await choose(op, rec, 'kind', d.getByLabel(/^Kampanya türü/), 'Hediye ürün');
      rec.mark('gift');
      await choose(op, rec, 'giftItem', d.getByLabel(/^Hediye ürün/), 'Türk Kahvesi');
      // The example line at the window's lower edge: the scope's summary of a gift campaign below it reads " · şu an 7 ürün"
      // (an app bug, src/Campaigns.tsx: no text before the dot for account campaigns); the edit cuts the moment it shows.
      await bringIn(op, step(d, 'Ne indirimi?').locator('.campaign-schedule-summary'), 640);
      rec.mark('example');
      await rec.look(op, 'example', step(d, 'Ne indirimi?').locator('.campaign-schedule-summary'), 3000);
      info.giftExample = await step(d, 'Ne indirimi?').locator('.campaign-schedule-summary').innerText();
      await rec.look(op, 'preview', d.locator('.campaign-preview'), 2400);
      info.giftPreview = await d.locator('.campaign-preview').innerText();
      await rec.tap(op, 'save', d.getByRole('button', { name: 'Kampanyayı kaydet' }), { hold: 300 });
      await op.locator('.campaign-editor-dialog').waitFor({ state: 'detached', timeout: 20000 });
      await pause(op, 900);
      rec.mark('saved');
      const grid = op.locator('.campaign-card-grid').first();
      await bring(op, op.locator('article.campaign-card', { hasText: GIFT }).first(), 120, 1100);
      await rec.look(op, 'cards', grid, 2800);
      info.campaignsAfter = await grid.innerText();
      await rec.stop(); }
    await w.ctx.close();

    // ===== g0: the guest's menu before the campaign starts (only for the split) =====
    await k.setClock(istanbul(0, 13, 40));
    console.log('Kayıt: g0-once');
    const masa07 = await tokenOf('Masa 07');
    { const ctx = await k.phoneContext(); await ctx.addInitScript('window.__molaNoFinger = true');
      const tel = await ctx.newPage();
      await k.openMenu(tel, masa07);
      const rec = new Recorder(tel, join(OUT, 'g0-once'), PHONE);
      await rec.start(); await pause(tel, 1000);
      await rec.tap(tel, 'kahveler', tel.locator('.category-tabs').getByRole('button', { name: 'Kahveler' }), { hold: 900 });
      await bring(tel, tel.locator('.product-grid'), 24, 1100);
      rec.mark('kahveler');
      await rec.look(tel, 'grid', tel.locator('.product-grid'), 3000);
      info.guestBefore = await tel.locator('.product-grid').innerText();
      await rec.stop();
      await ctx.close(); }

    // ===== g1: 15:00, the guest's menu with the campaign =====
    await k.setClock(istanbul(0, 15, 0));
    await tablet.ctx.close(); tablet = await k.staffScreen('garson', 'tablet');
    console.log('Kayıt: g1-misafir');
    { const ctx = await k.phoneContext(); await ctx.addInitScript('window.__molaNoFinger = true');
      const tel = await ctx.newPage();
      await k.openMenu(tel, masa07);
      const rec = new Recorder(tel, join(OUT, 'g1-misafir'), PHONE);
      await rec.start(); await pause(tel, 1400);
      await rec.tap(tel, 'offers', tel.locator('.category-tabs').getByRole('button', { name: 'Kampanyalı ürünler' }), { hold: 1200 });
      rec.mark('offers');
      await rec.look(tel, 'strip', tel.locator('.category-offer-strip'), 3000);
      info.strip = await tel.locator('.category-offer-strip').innerText().catch(() => '');
      await smoothScroll(tel, 520, 1400); await pause(tel, 600);
      rec.mark('scrolled');
      await rec.look(tel, 'deals', tel.locator('.product-grid'), 2600);
      await toTop(tel);
      await rec.tap(tel, 'kahveler', tel.locator('.category-tabs').getByRole('button', { name: 'Kahveler' }), { hold: 900 });
      await bring(tel, tel.locator('.product-grid'), 24, 1100);
      rec.mark('kahveler');
      await rec.look(tel, 'grid', tel.locator('.product-grid'), 3200);
      await tel.screenshot({ path: join(OUT, 'kapak-telefon.png') });
      info.guestAfter = await tel.locator('.product-grid').innerText();
      await rec.tap(tel, 'latte', tel.locator('.product-card', { hasText: 'Caffè Latte' }).first(), { hold: 1300 });
      rec.mark('dialog');
      await rec.look(tel, 'product', dialog(tel), 2800);
      info.latteDialog = await dialog(tel).innerText();
      await rec.stop();
      await ctx.close(); }

    // ===== t1: the waiter's order with both campaigns =====
    await k.setClock(istanbul(0, 15, 5));
    console.log('Kayıt: t1-garson');
    { const tp = tablet.page;
      const rec = new Recorder(tp, join(OUT, 't1-garson'), TABLET);
      await rec.start(); await pause(tp, 1200);
      await rec.tap(tp, 'table', tableCard(tp, 'Masa 04'), { hold: 1500 });
      await rec.tap(tp, 'add', dialog(tp).getByRole('button', { name: /Sipariş ekle/ }), { hold: 1500 });
      rec.mark('composer');
      await rec.tap(tp, 'cat', tp.locator('.category-tabs').getByRole('button', { name: 'Kahveler' }), { hold: 1100 });
      rec.mark('prices');
      await rec.look(tp, 'prices', tp.locator('.staff-grid'), 2200);
      await rec.tap(tp, 'latte', tp.locator('.staff-card', { hasText: 'Caffè Latte' }).first(), { hold: 1300 });
      const dlg = tp.getByRole('dialog').last();
      await rec.tap(tp, 'more', dlg.getByRole('button', { name: 'Adedi artır' }), { hold: 700 });
      await rec.tap(tp, 'toCart', dlg.getByRole('button', { name: /Sepete ekle/ }), { hold: 1100 });
      await rec.tap(tp, 'cat2', tp.locator('.category-tabs').getByRole('button', { name: 'Tatlılar' }), { hold: 1100 });
      await addPieces(tp, rec, 'San Sebastian', 2, 'ss');
      const hint = tp.locator('.deal-hint-chip').first();
      await hint.waitFor({ timeout: 15000 });
      rec.mark('hint');
      await rec.look(tp, 'hint', hint, 3000);
      info.hint = await hint.innerText();
      await rec.tap(tp, 'gift', hint, { hold: 1200 });
      await rec.tap(tp, 'cart', tp.locator('.staff-basket-open'), { hold: 1400 });
      rec.mark('basket');
      await rec.look(tp, 'basket', dialog(tp), 3400);
      info.basket = await dialog(tp).innerText();
      await rec.tap(tp, 'send', dialog(tp).getByRole('button', { name: /Siparişi gönder/ }), { hold: 300 });
      await tp.getByText(/mutfağa gönderildi/).first().waitFor({ timeout: 15000 }).catch(() => {});
      rec.mark('sent'); await pause(tp, 1400);
      await rec.stop(); }
    await k.advance(['preparing', 'ready', 'served'], 'Masa 04');

    // ===== k1: the counter: the bill of Masa 04 =====
    await k.setClock(istanbul(0, 15, 40));
    console.log('Kayıt: k1-kasa');
    { const counter = await k.staffScreen('kasiyer', 'desktop'), cp = counter.page;
      const rec = new Recorder(cp, join(OUT, 'k1-kasa'), DESKTOP);
      await rec.start(); await pause(cp, 1200);
      await rec.tap(cp, 'table', tableCard(cp, 'Masa 04'), { hold: 1500 });
      const lines = dialog(cp).locator('.order-lines').first();
      await lines.waitFor({ timeout: 15000 });
      rec.mark('bill');
      await rec.look(cp, 'lines', lines, 4000);
      info.bill = await dialog(cp).innerText();
      await rec.tap(cp, 'pay', dialog(cp).getByRole('button', { name: 'Ödeme al' }), { hold: 1400 });
      rec.mark('modal');
      await rec.look(cp, 'balance', dialog(cp).locator('.payment-balance'), 1600);
      info.balance = await dialog(cp).locator('.payment-balance').innerText();
      await rec.tap(cp, 'card', dialog(cp).locator('.payment-method').getByRole('button', { name: 'Kart' }), { hold: 900 });
      await rec.tap(cp, 'save', dialog(cp).getByRole('button', { name: /Ödemeyi kaydet/ }), { hold: 300 });
      await cp.getByText(/Hesap kapandı|Ödeme tamamlandı|kaydedildi/).first().waitFor({ timeout: 15000 }).catch(() => {});
      rec.mark('paid'); await pause(cp, 2200);
      await rec.stop();
      await counter.ctx.close(); }

    // ===== The afternoon (off camera): coffee rounds until LAST coffees are left in the quota =====
    { let left = (await campaignOf(CAMPAIGN))!.remainingQuantity!, at = 15 * 60 + 48, i = 0;
      const tables = ['Masa 01', 'Masa 02', 'Masa 06', 'Masa 08', 'Masa 09', 'Masa 10', 'Masa 11', 'Masa 12', 'Masa 13', 'Masa 14'];
      const served: string[] = [];
      while (left > LAST) {
        const round = ROUNDS[i % ROUNDS.length], coffees = round.filter(([n]) => COFFEES.includes(n)).reduce((n, [, q]) => n + q, 0);
        let lines = round;
        if (coffees > left - LAST) { let room = left - LAST; lines = round.flatMap(([n, q, ...r]) => { if (!COFFEES.includes(n)) return [[n, q, ...r] as Want]; const take = Math.min(q, room); room -= take; return take ? [[n, take, ...r] as Want] : []; }); }
        await k.setClock(istanbul(0, Math.floor(at / 60), at % 60));
        await k.order(tables[i % tables.length], lines);
        served.push(tables[i % tables.length]);
        left = (await campaignOf(CAMPAIGN))!.remainingQuantity!;
        at += 6; i++;
      }
      await k.advance(['preparing', 'ready', 'served']);
      await k.setClock(istanbul(0, 16, 32));
      for (const [n, t] of served.entries()) await k.pays(t, n % 3 === 1 ? 'cash' : 'card');
      info.afternoon = { rounds: i, left }; }

    // ===== o1: the quota fills: "Kampanya bitti", the campaign report =====
    await k.setClock(istanbul(0, 16, 36));
    console.log('Kayıt: o1-bitti');
    w = await k.ownerWindow({ campaignWindow: true }); op = w.page;
    await nav(op, 'Menü yönetimi').click(); await pause(op, 900);
    await op.locator('[data-home-tab="campaigns"]').click(); await pause(op, 1500);
    await bring(op, op.locator('article.campaign-card', { hasText: CAMPAIGN }).first(), 160, 600); await pause(op, 800);
    { const rec = new Recorder(op, join(OUT, 'o1-bitti'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      const card = op.locator('article.campaign-card', { hasText: CAMPAIGN }).first();
      await rec.look(op, 'quota', card, 2800);
      info.quotaBefore = await card.innerText();
      // The last coffees of the afternoon (off camera) use the quota up.
      await k.order('Masa 15', [['Caffè Latte', 1], ['Americano', 1], ['Türk Kahvesi', 1]]);
      await pause(op, 6000);
      rec.mark('full');
      await rec.look(op, 'full', card, 2600).catch(() => {});
      info.quotaAfter = await op.locator('.campaign-card-grid, .campaign-ended').last().innerText().catch(() => '');
      // The window looks for new notifications every minute: a minute passes.
      await k.setClock(k.now() + 70_000);
      const ended = op.locator('dialog.campaign-ended-dialog');
      await ended.waitFor({ timeout: 90000 });
      await ended.locator('.campaign-ended-figures').waitFor({ timeout: 30000 }).catch(() => {});
      await pause(op, 900);
      rec.mark('ended');
      await rec.look(op, 'figures', ended, 4600);
      info.ended = await ended.innerText();
      await rec.tap(op, 'report', ended.getByRole('button', { name: 'Raporu aç' }), { hold: 1600 });
      await op.locator('.campaign-report-grid').first().waitFor({ timeout: 20000 });
      await pause(op, 800);
      rec.mark('report');
      await rec.look(op, 'summary', op.locator('.campaign-report-grid').first(), 4000);
      info.report = await op.locator('.campaign-report-grid').first().innerText();
      const products = op.locator('.campaign-product-report');
      await bring(op, products, 110, 1100);
      rec.mark('products');
      await rec.look(op, 'products', products, 3600);
      info.reportProducts = await products.innerText();
      await rec.stop(); }
    await w.ctx.close();
    await k.advance(['preparing', 'ready', 'served']);
    await k.setClock(istanbul(0, 17, 5));
    await k.settleAll();

    // ===== r1: a reservation with kapora =====
    await k.setClock(istanbul(0, 17, 25));
    console.log('Kayıt: r1-rezerv');
    w = await k.ownerWindow(); op = w.page;
    { const rec = new Recorder(op, join(OUT, 'r1-rezerv'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', nav(op, 'Ajanda ve rezervasyon'), { hold: 1600 });
      await op.locator('.resv-plan').waitFor({ timeout: 20000 });
      rec.mark('plan');
      await rec.look(op, 'planLook', op.locator('.resv-plan'), 2000);
      await retype(op, rec, 'time', op.locator('.resv-plan-time input'), '1930');
      await op.keyboard.press('Tab'); await pause(op, 1200);
      rec.mark('time');
      await rec.tap(op, 'table', tile(op, 'Masa 05'), { hold: 1300 });
      const f = dialog(op);
      rec.mark('form');
      await typeIn(op, rec, 'name', f.getByPlaceholder('Ör. Ahmet Yılmaz'), 'Ayşe Yılmaz', { delay: 80 });
      await retype(op, rec, 'people', f.getByLabel('Kişi sayısı'), '4');
      await typeIn(op, rec, 'note', f.getByPlaceholder('Ör. Doğum günü, pencere kenarı'), 'Doğum günü', { delay: 80 });
      rec.mark('deposit');
      await rec.tap(op, 'depositOn', f.getByLabel('Kapora alındı'), { hold: 900 });
      await typeIn(op, rec, 'amount', f.getByLabel('Tutar (TL)'), '500', { delay: 120 });
      await rec.look(op, 'method', f.locator('.resv-deposit'), 1800);
      await rec.tap(op, 'save', f.getByRole('button', { name: 'Kaydet', exact: true }), { hold: 300 });
      await f.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
      await pause(op, 1000);
      rec.mark('saved');
      await rec.look(op, 'tile', op.locator('.plan-cell[data-table="Masa 05"]'), 2600);
      info.tile = await op.locator('.plan-cell[data-table="Masa 05"]').innerText();
      const day = op.locator('section.resv-day');
      await bring(op, day, 200, 1100);
      rec.mark('list');
      await rec.look(op, 'list', day, 3000);
      info.dayList = await day.innerText();
      await rec.stop(); }
    await w.ctx.close();

    // ===== t2: 18:35, the floor before the table is held (only for the split) =====
    await k.setClock(istanbul(0, 18, 35));
    await tablet.ctx.close(); tablet = await k.staffScreen('garson', 'tablet');
    let tp = tablet.page;
    const grid = () => tp.locator('.table-grid').first();
    async function floorClip(name: string) {
      await bring(tp, tableCard(tp, 'Masa 05'), 230, 800); await pause(tp, 2500);
      const rec = new Recorder(tp, join(OUT, name), TABLET);
      await rec.start(); await pause(tp, 1000);
      await rec.box('card', tableCard(tp, 'Masa 05'));
      await rec.box('grid', grid());
      await rec.look(tp, 'card', tableCard(tp, 'Masa 05'), 3600);
      info[name] = await tableCard(tp, 'Masa 05').innerText();
      await rec.stop();
    }
    console.log('Kayıt: t2-once');
    await floorClip('t2-once');

    // ===== s1: the setting: how long before a reservation the table is held =====
    await k.setClock(istanbul(0, 18, 36));
    console.log('Kayıt: s1-ayar');
    w = await k.ownerWindow(); op = w.page;
    { const rec = new Recorder(op, join(OUT, 's1-ayar'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', nav(op, 'Ajanda ve rezervasyon'), { hold: 1400 });
      await rec.tap(op, 'part', agendaPart(op, 'Ayarlar'), { hold: 1500 });
      const row = op.locator('.settings-row', { hasText: 'Rezervasyondan kaç dakika önce masa ayrılsın' });
      await row.waitFor({ timeout: 20000 });
      rec.mark('card');
      await rec.look(op, 'row', row, 3000);
      info.holdBefore = await row.innerText();
      await rec.tap(op, 'hold', row.getByRole('button', { name: '1 saat önce' }), { lead: 2400, hold: 1500 });
      rec.mark('set');
      await rec.look(op, 'line', row.locator('.settings-row-copy p'), 3600);
      info.holdAfter = await row.innerText();
      await rec.stop(); }
    await w.ctx.close();

    // ===== t3: the floor now: Masa 05 held, its QR closed for new orders =====
    await k.setClock(istanbul(0, 18, 37));
    await tp.reload(); await pause(tp, 2500);
    await tableCard(tp, 'Masa 05').locator('.table-resv').first().waitFor({ timeout: 30000 });
    console.log('Kayıt: t3-sonra');
    await floorClip('t3-sonra');

    // ===== g2: the guest's phone at the held table =====
    console.log('Kayıt: g2-rezerve');
    { const ctx = await k.phoneContext(); await ctx.addInitScript('window.__molaNoFinger = true');
      const tel = await ctx.newPage();
      await k.openMenu(tel, await tokenOf('Masa 05'));
      const note = tel.locator('[data-testid="ordering-reserved"]');
      await note.waitFor({ timeout: 20000 }); await pause(tel, 600);
      const rec = new Recorder(tel, join(OUT, 'g2-rezerve'), PHONE);
      await rec.start(); await pause(tel, 800);
      await rec.look(tel, 'note', note, 4600);
      info.reservedNote = await note.innerText();
      await rec.stop();
      await ctx.close(); }

    // ===== t4: 19:20, the guest comes: Geldi, the order, the kapora on the bill =====
    await k.setClock(istanbul(0, 19, 20));
    await tablet.ctx.close(); tablet = await k.staffScreen('garson', 'tablet'); tp = tablet.page;
    await bring(tp, tableCard(tp, 'Masa 05'), 230, 800); await pause(tp, 1500);
    console.log('Kayıt: t4-geldi');
    { const rec = new Recorder(tp, join(OUT, 't4-geldi'), TABLET);
      await rec.start(); await pause(tp, 1200);
      await rec.tap(tp, 'table', tableCard(tp, 'Masa 05'), { hold: 1500 });
      const panel = dialog(tp).locator('.resv-panel');
      await panel.waitFor({ timeout: 15000 });
      rec.mark('window');
      await rec.look(tp, 'panel', panel, 3000);
      info.panelBefore = await panel.innerText();
      await rec.tap(tp, 'seat', panel.getByRole('button', { name: 'Geldi', exact: true }), { hold: 1600 });
      // "Geldi" closes the window: the guest's name is on the table now.
      await tableCard(tp, 'Masa 05').getByText('Ayşe Yılmaz').first().waitFor({ timeout: 15000 });
      rec.mark('seated');
      await rec.look(tp, 'guest', tableCard(tp, 'Masa 05'), 2400);
      info.cardSeated = await tableCard(tp, 'Masa 05').innerText();
      // The order is taken as usual (off camera here), then the table's window: the kapora taken off this bill.
      await k.order('Masa 05', [['Ev Yapımı Limonata', 3], ['Demleme Çay', 2], ['Künefe', 1]]);
      await pause(tp, 2500);
      rec.mark('ordered');
      await rec.tap(tp, 'table2', tableCard(tp, 'Masa 05'), { hold: 1400 });
      const deposit = dialog(tp).locator('.resv-panel-row.deposit');
      await deposit.waitFor({ timeout: 15000 });
      await pause(tp, 1200);
      rec.mark('deposit');
      await rec.look(tp, 'deposit', dialog(tp).locator('.resv-panel'), 3800);
      info.panelDeposit = await dialog(tp).locator('.resv-panel').innerText();
      await rec.stop();
      await tp.keyboard.press('Escape'); await pause(tp, 500); }

    // ===== e1: an event with temporary tables (tomorrow evening) =====
    await k.setClock(istanbul(0, 19, 40));
    const tomorrow = new Date(istanbul(1, 12, 0)).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\D/g, '');
    console.log('Kayıt: e1-etkinlik');
    w = await k.ownerWindow(); op = w.page;
    { const rec = new Recorder(op, join(OUT, 'e1-etkinlik'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', nav(op, 'Ajanda ve rezervasyon'), { hold: 1400 });
      await rec.tap(op, 'part', agendaPart(op, 'Etkinlikler'), { hold: 1500 });
      rec.mark('events');
      await rec.look(op, 'lead', op.locator('.resv-toolbar'), 2000);
      await rec.tap(op, 'create', op.getByRole('button', { name: 'Etkinlik oluştur' }), { hold: 1400 });
      const f = dialog(op);
      rec.mark('form');
      await typeIn(op, rec, 'name', f.getByLabel(/^Etkinlik adı/), EVENT, { delay: 80 });
      await retype(op, rec, 'day', fieldOf(f, /^Gün/), tomorrow);
      await retype(op, rec, 'start', fieldOf(f, /^Başlangıç saati/), '2030');
      await typeIn(op, rec, 'end', fieldOf(f, /^Bitiş saati/), '2230', { delay: 110 });
      // Left without Tab (the next focus is the ⓘ of "Kaç masa?", which would open its bubble).
      await fieldOf(f, /^Bitiş saati/).evaluate(e => (e as HTMLInputElement).blur()); await pause(op, 600);
      rec.mark('when');
      await rec.look(op, 'whenLine', step(f, 'Ne zaman?').locator('.step-result'), 2000);
      await bringIn(op, step(f, 'Kaç masa?'), 12);
      rec.mark('tables');
      await retype(op, rec, 'count', f.getByLabel(/^Geçici masa sayısı/), '12');
      await typeIn(op, rec, 'capacity', f.getByLabel(/^Bir masada kaç kişi/), '4', { delay: 120 });
      await bringIn(op, step(f, 'Masa adları'), 12);
      rec.mark('names');
      await rec.look(op, 'chips', step(f, 'Masa adları'), 2600);
      await bringIn(op, step(f, 'Masalar ekranı'), 12);
      await rec.look(op, 'screen', step(f, 'Masalar ekranı'), 1800);
      await rec.tap(op, 'save', f.getByRole('button', { name: 'Etkinliği oluştur' }), { hold: 300 });
      await f.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
      await pause(op, 1000);
      rec.mark('saved');
      const card = op.locator('article.event-card').first();
      await rec.look(op, 'card', card, 3200);
      info.eventCard = await card.innerText();
      await rec.stop(); }
    await w.ctx.close();

    // ===== Off camera: the event's reservations, tonight's bills, the gün sonu =====
    type EventRow = { id: string; name: string; day: string; start: string; tableState: { id: string; name: string }[] };
    const ev = (await get<{ events: EventRow[] }>('/api/staff/events')).events.find(e => e.name === EVENT)!;
    const eventTable = (name: string) => ev.tableState.find(t => t.name === name)!.id;
    const booked: Record<string, string> = {};
    for (const [table, name, people, deposit] of [['D1', 'Hakan Öztürk', 6, 100000], ['D2', 'Oğuz Tan', 4, 0], ['D5', 'Selin Aksoy', 4, 0]] as const) {
      const r = await owner(req => k.post(req, '/api/staff/reservations', { requestId: randomUUID(), tableId: eventTable(table), day: ev.day, time: ev.start, name, people, phone: null, note: null, deposit: deposit ? { amount: deposit, method: 'cash' } : null, remind: null })) as { reservation?: { id: string }; id?: string };
      booked[name] = r.reservation?.id ?? r.id ?? '';
    }
    info.eventBookings = booked;
    await k.advance(['preparing', 'ready', 'served'], 'Masa 05');
    await k.setClock(istanbul(0, 20, 40));
    await k.pays('Masa 05', 'card');
    await k.setClock(istanbul(0, 21, 30));
    await k.settleAll();
    await k.setClock(istanbul(0, 23, 0));
    info.closing = await k.closeKasa();
    await tablet.ctx.close();

    // ===== Tomorrow: the kasa opened; at 20:30 the event starts by itself =====
    await k.setClock(istanbul(1, 8, 30));
    await k.openKasa(50000);
    await k.setClock(istanbul(1, 20, 36));
    { const view = await get<{ reservations: { id: string; name: string }[] }>(`/api/staff/reservations?from=${ev.day}&to=${ev.day}`);
      for (const name of ['Hakan Öztürk', 'Oğuz Tan']) { const r = view.reservations.find(x => x.name === name)!; await owner(req => k.post(req, '/api/staff/reservations/seat', { requestId: randomUUID(), id: r.id })); } }
    for (const [table, name, people] of [['D3', 'Emre', 3], ['D4', 'Derya', 2], ['D7', 'Okan', 4]] as const)
      await owner(req => k.post(req, '/api/staff/reservations/walk-in', { requestId: randomUUID(), tableId: eventTable(table), name, people }));
    const EVENING: [string, Want[]][] = [
      ['D1', [['Ev Yapımı Limonata', 3], ['Caffè Latte', 3], ['Fıstıklı Baklava', 2]]],
      ['D2', [['Americano', 2], ['Ayran', 2], ['Künefe', 1]]],
      ['D3', [['Demleme Çay', 3], ['San Sebastian', 1]]],
      ['D4', [['Ev Yapımı Limonata', 2], ['Profiterol', 1]]],
      ['D6', [['Ayran', 2], ['Demleme Çay', 2]]],
      ['D7', [['Americano', 2], ['Caffè Latte', 2], ['Çikolatalı Brownie', 1]]],
    ];
    for (const [table, lines] of EVENING) await k.order(table, lines);
    await k.advance(['preparing', 'ready', 'served']);

    // ===== t5: the event's tables on the tablet's Masalar =====
    await k.setClock(istanbul(1, 20, 55));
    tablet = await k.staffScreen('garson', 'tablet'); tp = tablet.page;
    console.log('Kayıt: t5-etkinlik');
    { const section = tp.locator('section.event-section').first();
      await section.waitFor({ timeout: 30000 });
      const rec = new Recorder(tp, join(OUT, 't5-etkinlik'), TABLET);
      await rec.start(); await pause(tp, 1200);
      await bring(tp, section, 90, 1500);
      rec.mark('section');
      await rec.look(tp, 'section', section, 3800);
      info.eventFloor = await section.innerText();
      await rec.tap(tp, 'table', tableCard(tp, 'D1'), { hold: 1500 });
      rec.mark('window');
      await rec.look(tp, 'window', dialog(tp), 3200);
      info.eventTable = await dialog(tp).innerText();
      await rec.stop();
      await tp.keyboard.press('Escape'); await pause(tp, 500); }
    await tablet.ctx.close();

    // ===== Off camera: the evening's bills =====
    await k.setClock(istanbul(1, 22, 40));
    for (const [n, [table]] of EVENING.entries()) await k.pays(table, n % 2 ? 'cash' : 'card');

    // ===== e2: the event closed; Satış ve Raporlar → Rezervasyon =====
    await k.setClock(istanbul(1, 22, 50));
    console.log('Kayıt: e2-kapat');
    w = await k.ownerWindow(); op = w.page;
    { const rec = new Recorder(op, join(OUT, 'e2-kapat'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', nav(op, 'Ajanda ve rezervasyon'), { hold: 1400 });
      await rec.tap(op, 'part', agendaPart(op, 'Etkinlikler'), { hold: 1500 });
      const card = op.locator('article.event-card').first();
      rec.mark('card');
      await rec.look(op, 'card', card, 3000);
      info.eventCardLate = await card.innerText();
      await rec.tap(op, 'close', card.getByRole('button', { name: /Etkinliği (kapat|bitir)/ }).first(), { hold: 1300 });
      rec.mark('dialog');
      await rec.look(op, 'confirm', dialog(op), 2600);
      info.closeDialog = await dialog(op).innerText();
      await rec.tap(op, 'confirm2', dialog(op).getByRole('button', { name: 'Etkinliği kapat' }), { hold: 300 });
      await op.locator('.notice-success').first().waitFor({ timeout: 15000 }).catch(() => {});
      await pause(op, 900);
      rec.mark('closed');
      await rec.look(op, 'notice', op.locator('.notice-success').first(), 2000);
      info.closedNotice = await op.locator('.notice-success').first().innerText().catch(() => '');
      await rec.tap(op, 'report', op.getByRole('button', { name: /^Rezervasyon raporu/ }), { hold: 1600 });
      await op.locator('.resv-report').waitFor({ timeout: 20000 });
      await rec.tap(op, 'd7', op.locator('.period-pills').getByRole('button', { name: '7 gün', exact: true }).first(), { hold: 1600 });
      await pause(op, 800);
      rec.mark('report');
      await rec.look(op, 'kpi', op.locator('.resv-report .kpi-row'), 3600);
      info.resvKpi = await op.locator('.resv-report .kpi-row').innerText();
      const money = op.locator('.resv-money');
      await rec.look(op, 'deposits', money, 2600);
      info.resvMoney = await money.innerText();
      const events = op.locator('.resv-events');
      await bring(op, events, 120, 1100);
      rec.mark('events');
      await rec.look(op, 'events', events, 3800);
      info.resvEvents = await events.innerText();
      await rec.stop(); }
    await w.ctx.close();
    info.end = ist(k.now());
  } catch (e) {
    let i = 0;
    for (const b of [k.deskBrowser, k.phoneBrowser]) for (const c of b?.contexts() ?? []) for (const p of c.pages()) await p.screenshot({ path: join(BASE, `hata-${++i}.png`) }).catch(() => {});
    throw e;
  } finally {
    writeFileSync(join(OUT, 'bilgi.json'), JSON.stringify(info, null, 1));
    await k.close();
  }
}
await main();
