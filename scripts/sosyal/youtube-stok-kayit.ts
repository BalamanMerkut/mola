/*
 * YouTube 02 "Stok, reçete ve kârlılık" (introduction series): recordings of the REAL app for one linear story of the owner's
 * Stok (edit: scripts/sosyal/youtube-stok-kurgu.ts). One run in story order on a fresh Mola Merkez + demo café ("Mola Örnek
 * Kafe", shared parts: scripts/sosyal/kayit-ortak.ts) in .local/sosyal/youtube/stok/run-<zaman>/.
 *
 * The run plays on the recording clock (kit({ saat })): the demo is made yesterday evening, its floor settled and its kasa
 * closed off camera. This morning (off camera): the kasa opened at 08:30, Stok set up as an owner does it (Kit.setUpStock: the
 * ingredients with what is on the shelf and their prices, the recipes of the drinks and Künefe), then the morning's tables
 * served and paid, so today's Kârlılık has figures and the shelf has moved. From 12:58 the owner on the café computer:
 *
 *   s1-malzeme   "Stok" → Malzemeler → "Malzeme ekle": Yulaf sütü, ml · Litre, 2 L on the shelf, Uyarı sınırı 1,5 L, ₺120 / L.
 *   s2-alis      "Alış ve sayım" → "Alış kaydet": Süt 12 L, ₺480 (birim fiyat ₺40 / L, önceki ₺36), Köy Mandırası, "Kasa
 *                dışından" → Havale / EFT → "Alışı kaydet"; the green note's "Giderlerde gör" → the expense in Giderler.
 *   s3-recete    "Stok" → Reçeteler → Caffè Latte: Espresso çekirdeği 18 g, Süt 200 ml; the options: Büyük %150, Yulaf sütü
 *                instead of Süt; the cost per option → "Reçeteyi kaydet".
 *   s4-toplu     San Sebastian → "Toplu üretimden hesapla": Krem peynir 1600 g, Yumurta 8, Krema 400 ml, Şeker 320 g,
 *                16 porsiyon → "Reçeteye yaz" → "Reçeteyi kaydet".
 *   s5-urunler   "Ürünler": Caffè Latte ≈ … adet yapılabilir, by option, the limiting ingredient.
 *   t1-satis     the waiter's tablet: Masa 05 → "Sipariş ekle" → Caffè Latte, Büyük, Yulaf sütü, 2 adet → "Siparişi gönder".
 *   s6-sonra     the owner again (recorded from the tablet's send on): Malzemeler (Yulaf sütü 1,4 L "Az kaldı"), the
 *                notification "Yulaf sütü azaldı", Ürünler (fewer Caffè Latte to make).
 *   s7-sayim     "Alış ve sayım" → "Sayım yap": Süt 20,5 L → the difference → "Sayımı kaydet".
 *   s8-karlilik  "Satış ve Raporlar" → "Detaylı göster" → Kârlılık (Bugün): the totals, categories, products; "Uyarı sınırları"
 *                → İçecekler %70 → %80 → "Kaydet" → close: the drinks under 80 % read "Düşük kâr".
 *
 *   npx tsx scripts/sosyal/youtube-stok-kayit.ts            (needs `npm run build`; ~7 minutes)
 *
 * No pointer: every tap goes through Recorder.tap (box saved, a still lead-in the edit cuts). Mola window 1280×800 (2×), waiter's
 * tablet 1180×820 (2×). Ports: café 3792, Mola Merkez 3793. Every process is stopped at the end.
 * Output: .local/sosyal/youtube/stok/kayit/<klip>/ (meta.json), kayit/bilgi.json (stock figures, the report's rows) and
 * kayit/kapak-telefon.png (the owner's Stok on a phone, off camera, for the thumbnail).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DEMO_RECIPES, DEMO_STOCK, DESKTOP, NO_HINTS, ROOT, Recorder, TABLET, choose, istanbul, kit, pause, smoothScroll, typeIn, type Want } from './kayit-ortak';

const BASE = join(ROOT, '.local', 'sosyal', 'youtube', 'stok');
const OUT = join(BASE, 'kayit');
const run = join(BASE, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const k = kit({ run, kafePort: 3792, merkezPort: 3793, saat: istanbul(-1, 22, 10) });
mkdirSync(OUT, { recursive: true });
const info: Record<string, unknown> = {};
const ist = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

/** This morning's Stok and the recipes written before (kayit-ortak.ts DEMO_STOCK, DEMO_RECIPES): Yulaf sütü, Caffè Latte and San Sebastian come on camera. */
const ITEMS = DEMO_STOCK, RECIPES = DEMO_RECIPES;
/** The morning (off camera): each visit ordered at its minute, made, served and paid 35 minutes later. */
const MORNING: { table: string; at: number; lines: Want[]; method: 'cash' | 'card' }[] = [
  { table: 'Masa 02', at: 8 * 60 + 50, lines: [['Türk Kahvesi', 2, ['Orta']], ['Demleme Çay', 2]], method: 'cash' },
  { table: 'Masa 06', at: 9 * 60 + 30, lines: [['Caffè Latte', 2, ['Standart']], ['San Sebastian', 1]], method: 'card' },
  { table: 'Masa 09', at: 10 * 60 + 10, lines: [['Americano', 2, ['Standart']], ['Künefe', 1]], method: 'card' },
  { table: 'Masa 11', at: 10 * 60 + 50, lines: [['Ev Yapımı Limonata', 2], ['San Sebastian', 1]], method: 'card' },
  { table: 'Masa 03', at: 11 * 60 + 30, lines: [['Demleme Çay', 3], ['Ihlamur', 1], ['Künefe', 1]], method: 'cash' },
  { table: 'Masa 14', at: 12 * 60 + 10, lines: [['Caffè Latte', 1, ['Standart']], ['Ev Yapımı Limonata', 1], ['Ihlamur', 1]], method: 'card' },
];

// ---------- On the screens ----------
const dialog = (page: Page) => page.getByRole('dialog').last();
const nav = (page: Page, name: string) => page.locator('aside nav').getByRole('button', { name: new RegExp(`^${name}`) });
const stockTab = (page: Page, name: string) => page.locator('.stock-tabs').getByText(name, { exact: true });
const notice = (page: Page) => page.locator('.notice-success').last();
const itemCard = (page: Page, name: string) => page.locator('.stock-item', { has: page.locator('.stock-item-head strong', { hasText: new RegExp(`^${name}$`) }) }).first();
const productRow = (page: Page, name: string) => page.locator('.stock-row', { has: page.locator('.stock-row-name strong', { hasText: new RegExp(`^${name}$`) }) }).first();
const tableCard = (page: Page, table: string) => page.locator('.table-card', { has: page.locator('h3', { hasText: new RegExp(`^${table}$`) }) }).first();
/** Scrolls so that `target` stands `at` px below the top of the window. */
async function bring(page: Page, target: Locator, at: number, ms = 1000) {
  const y = await target.evaluate((e, a) => e.getBoundingClientRect().top - a, at);
  if (Math.abs(y) > 4) { await smoothScroll(page, Math.round(y), ms); await pause(page, 500); }
}
/** Scrolls the open window (a dialog) so that `target` stands `at` px below the dialog's top. */
async function bringIn(page: Page, target: Locator, at: number) {
  await target.evaluate((e, a) => {
    const box = e.closest('dialog') as HTMLElement | null; if (!box) return;
    const by = e.getBoundingClientRect().top - box.getBoundingClientRect().top - a;
    box.scrollBy({ top: by, behavior: 'smooth' });
  }, at);
  await pause(page, 900);
}
/** A field's text replaced: the tap, everything selected, the new text typed. */
async function retype(page: Page, rec: Recorder, name: string, field: Locator, text: string) {
  await rec.tap(page, name, field, { lead: 700, hold: 150 });
  await page.keyboard.press('Control+A'); await pause(page, 150);
  await field.pressSequentially(text, { delay: 110 });
  await pause(page, 300);
}

async function main() {
  await k.launch();
  const desk = k.deskBrowser;
  try {
    await k.startServers();
    await k.prepareMenu(desk, { waiterApproval: false, changeSeconds: 0 });
    await k.calm(desk, true);

    // ===== Yesterday evening (off camera): the floor settled, the kasa closed =====
    await k.settleAll();
    info.closedCash = await k.closeKasa();

    // ===== This morning (off camera): the kasa opened, Stok set up, the morning's tables =====
    await k.setClock(istanbul(0, 8, 30));
    await k.openKasa();
    await k.setUpStock(ITEMS, RECIPES);
    await k.serveDay(MORNING);
    await k.setClock(istanbul(0, 12, 58));
    await k.readNotifications();
    info.lunch = ist(k.now());
    info.stockMorning = await k.stockLevels();
    console.log('Öğle:', info.lunch, JSON.stringify(info.stockMorning));

    // The owner on the café computer; the waiter's tablet (Masalar) for the sale.
    const owner = await k.staffScreen('isletme', 'desktop'), op = owner.page;
    await op.addInitScript(NO_HINTS); await op.reload(); await pause(op, 1500);
    // The reload locks the sounds again: a click on the page header unlocks them (the "Ses kapalı" note goes away).
    await op.mouse.click(640, 20); await pause(op, 500);
    const sound = op.getByText(/Ses kapalı/).first();
    if (await sound.isVisible().catch(() => false)) { await sound.click(); await pause(op, 500); }
    const waiter = await k.staffScreen('garson', 'tablet'), tp = waiter.page;
    await nav(tp, 'Masalar').click(); await pause(tp, 900); await tp.evaluate('scrollTo(0, 0)');

    // ===== s1: a new ingredient =====
    console.log('Kayıt: s1-malzeme');
    { const rec = new Recorder(op, join(OUT, 's1-malzeme'), DESKTOP);
      await rec.start(); await pause(op, 1200);
      await rec.tap(op, 'nav', nav(op, 'Stok'), { hold: 1800 });
      rec.mark('items');
      await rec.look(op, 'list', op.locator('.stock-items').first(), 3000);
      await rec.tap(op, 'add', op.locator('.stock-section-head').getByRole('button', { name: 'Malzeme ekle' }), { hold: 1300 });
      rec.mark('form');
      const d = dialog(op);
      await typeIn(op, rec, 'name', d.getByLabel('Malzeme adı'), 'Yulaf sütü', { delay: 80 });
      await rec.tap(op, 'unit', d.getByRole('group', { name: 'Ölçü birimi' }).getByRole('button', { name: 'ml · Litre' }), { hold: 1000 });
      rec.mark('amounts');
      await typeIn(op, rec, 'initial', d.getByLabel('Şu an elinizde ne kadar var?', { exact: true }), '2', { delay: 120 });
      await typeIn(op, rec, 'min', d.getByLabel('Uyarı sınırı', { exact: true }), '1,5', { delay: 120 });
      await pause(op, 900);
      await rec.look(op, 'minHint', d.locator('.stock-amount', { has: op.getByLabel('Uyarı sınırı', { exact: true }) }), 2400);
      await typeIn(op, rec, 'price', d.getByRole('textbox', { name: 'Birim fiyat (TL / L)' }), '120', { delay: 120 });
      await pause(op, 900);
      await rec.tap(op, 'save', d.getByRole('button', { name: 'Malzemeyi ekle' }), { hold: 300 });
      await notice(op).waitFor({ timeout: 15000 });
      rec.mark('saved'); await pause(op, 1200);
      await itemCard(op, 'Yulaf sütü').evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'smooth' })); await pause(op, 1100);
      rec.mark('card');
      await rec.look(op, 'card', itemCard(op, 'Yulaf sütü'), 3000);
      await rec.stop();
      info.items = await op.locator('.stock-items').first().innerText().catch(() => ''); }

    // ===== s2: a purchase, its expense =====
    console.log('Kayıt: s2-alis');
    { const rec = new Recorder(op, join(OUT, 's2-alis'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'tab', stockTab(op, 'Alış ve sayım'), { hold: 1600 });
      rec.mark('entries');
      await rec.tap(op, 'buy', op.locator('.stock-action', { hasText: 'Alış kaydet' }), { hold: 1300 });
      rec.mark('form');
      const d = dialog(op);
      await choose(op, rec, 'item', d.getByLabel(/^Malzeme/), 'Süt');
      await typeIn(op, rec, 'qty', d.getByLabel('Alınan miktar *', { exact: true }), '12', { delay: 140 });
      await typeIn(op, rec, 'total', d.getByLabel('Toplam tutar (TL)'), '480', { delay: 140 });
      await pause(op, 700);
      await rec.look(op, 'calc', d.locator('.stock-calc'), 2800);
      await typeIn(op, rec, 'supplier', d.getByLabel(/Tedarikçi/), 'Köy Mandırası', { delay: 70 });
      await rec.tap(op, 'outside', d.getByRole('radio', { name: /Kasa dışından/ }), { hold: 1200 });
      rec.mark('paid');
      await choose(op, rec, 'how', d.getByRole('combobox', { name: 'Nasıl ödendi' }), 'Havale / EFT');
      await rec.tap(op, 'save', d.getByRole('button', { name: 'Alışı kaydet' }), { hold: 300 });
      await notice(op).waitFor({ timeout: 15000 });
      rec.mark('saved'); await pause(op, 600);
      await rec.look(op, 'notice', notice(op), 3200);
      info.purchase = await notice(op).innerText().catch(() => '');
      await rec.tap(op, 'expenses', notice(op).getByText('Giderlerde gör'), { hold: 1800 });
      rec.mark('giderler');
      const row = op.locator('tr, li, article', { hasText: /Stok alışı: Süt/ }).last();
      await row.waitFor({ timeout: 15000 });
      await row.evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'smooth' })); await pause(op, 1000);
      await rec.look(op, 'expense', row, 3200);
      await rec.stop();
      info.expense = await row.innerText().catch(() => ''); }

    // ===== s3: the recipe of Caffè Latte, its options =====
    console.log('Kayıt: s3-recete');
    { const rec = new Recorder(op, join(OUT, 's3-recete'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'nav', nav(op, 'Stok'), { hold: 1400 });
      await rec.tap(op, 'tab', stockTab(op, 'Reçeteler'), { hold: 1600 });
      rec.mark('list');
      await rec.tap(op, 'latte', op.getByRole('button', { name: /^Caffè Latte reçetesi/ }), { hold: 1600 });
      rec.mark('modal');
      const d = dialog(op);
      await choose(op, rec, 'item1', d.getByLabel('1. malzeme', { exact: true }), 'Espresso çekirdeği');
      await typeIn(op, rec, 'amt1', d.getByLabel('1. malzemenin miktarı', { exact: true }), '18', { delay: 140 });
      await rec.tap(op, 'row', d.locator('.stock-recipe > .stock-add-row'), { hold: 800 });
      await choose(op, rec, 'item2', d.getByLabel('2. malzeme', { exact: true }), 'Süt');
      await typeIn(op, rec, 'amt2', d.getByLabel('2. malzemenin miktarı', { exact: true }), '200', { delay: 140 });
      await pause(op, 900);
      rec.mark('items');
      await rec.tap(op, 'options', d.locator('details.stock-options > summary > span').first(), { hold: 1200 });
      rec.mark('optionsOpen');
      await choose(op, rec, 'large', d.getByLabel('Büyük seçeneği reçeteyi nasıl değiştirir'), 'Miktar değişir (%)');
      const largeRow = d.locator('.stock-option-row', { has: op.getByLabel('Büyük seçeneği reçeteyi nasıl değiştirir') });
      await rec.look(op, 'largeEffect', largeRow, 2800);
      await choose(op, rec, 'oat', d.getByLabel('Yulaf sütü seçeneği reçeteyi nasıl değiştirir'), 'Yerine başka malzeme');
      await choose(op, rec, 'from', d.getByLabel('Yulaf sütü: yerine kullanılmayan malzeme'), 'Süt');
      await choose(op, rec, 'to', d.getByLabel('Yulaf sütü: kullanılan malzeme'), 'Yulaf sütü');
      const oatRow = d.locator('.stock-option-row', { has: op.getByLabel('Yulaf sütü seçeneği reçeteyi nasıl değiştirir') });
      await rec.look(op, 'oatEffect', oatRow, 2800);
      const costs = d.locator('.stock-cost-preview').first();
      await bringIn(op, costs, 80);
      rec.mark('costs');
      await rec.look(op, 'costs', costs, 3600);
      info.latteCosts = await costs.innerText().catch(() => '');
      await rec.tap(op, 'save', d.getByRole('button', { name: 'Reçeteyi kaydet' }), { hold: 300 });
      await notice(op).waitFor({ timeout: 15000 });
      rec.mark('saved'); await pause(op, 900);
      await rec.look(op, 'row', productRow(op, 'Caffè Latte'), 2600);
      await rec.stop(); }

    // ===== s4: San Sebastian from a whole batch =====
    console.log('Kayıt: s4-toplu');
    { const rec = new Recorder(op, join(OUT, 's4-toplu'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'ss', op.getByRole('button', { name: /^San Sebastian reçetesi/ }), { hold: 1600 });
      rec.mark('modal');
      const d = dialog(op);
      await rec.tap(op, 'batch', d.getByRole('button', { name: 'Toplu üretimden hesapla' }), { lead: 2000, hold: 1300 });
      rec.mark('batch');
      const b = d.locator('.stock-batch');
      const lines: [string, string][] = [['Krem peynir', '1600'], ['Yumurta', '8'], ['Krema', '400'], ['Şeker', '320']];
      for (const [i, [name, total]] of lines.entries()) {
        if (i > 0) await rec.tap(op, `more${i}`, b.getByRole('button', { name: 'Malzeme ekle' }), { hold: 700 });
        await choose(op, rec, `item${i}`, b.getByLabel(`Toplu üretimde ${i + 1}. malzeme`, { exact: true }), name);
        await typeIn(op, rec, `total${i}`, b.getByLabel(`${name} toplam miktarı`, { exact: true }), total, { delay: 130 });
      }
      rec.mark('totals');
      await typeIn(op, rec, 'portions', b.getByLabel('Kaç porsiyon çıktı?'), '16', { delay: 160 });
      await pause(op, 800);
      rec.mark('result');
      await rec.look(op, 'result', b.locator('.stock-batch-result'), 3600);
      info.batch = await b.locator('.stock-batch-result').innerText().catch(() => '');
      await rec.tap(op, 'write', b.getByRole('button', { name: 'Reçeteye yaz' }), { hold: 1200 });
      rec.mark('written');
      await rec.look(op, 'rows', d.locator('.stock-recipe-rows'), 3000);
      const cost = d.locator('.stock-cost-preview').first();
      await bringIn(op, cost, 120);
      await rec.look(op, 'cost', cost, 2600);
      info.ssCost = await cost.innerText().catch(() => '');
      await rec.tap(op, 'save', d.getByRole('button', { name: 'Reçeteyi kaydet' }), { hold: 300 });
      await notice(op).waitFor({ timeout: 15000 });
      rec.mark('saved'); await pause(op, 900);
      await rec.look(op, 'row', productRow(op, 'San Sebastian'), 2600);
      await rec.stop(); }

    // ===== s5: how many can still be made =====
    console.log('Kayıt: s5-urunler');
    await op.evaluate('scrollTo(0, 0)'); await pause(op, 600);
    { const rec = new Recorder(op, join(OUT, 's5-urunler'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'tab', stockTab(op, 'Ürünler'), { hold: 1600 });
      rec.mark('products');
      await rec.look(op, 'stats', op.locator('.stock-stats').first(), 2400);
      await bring(op, productRow(op, 'Caffè Latte'), 150);
      rec.mark('latte');
      await rec.look(op, 'latte', productRow(op, 'Caffè Latte'), 4200);
      info.latteBefore = await productRow(op, 'Caffè Latte').innerText().catch(() => '');
      await rec.stop(); }

    // ===== t1 + s6: the sale on the waiter's tablet, then the owner's Stok =====
    console.log('Kayıt: t1-satis / s6-sonra');
    { const recT = new Recorder(tp, join(OUT, 't1-satis'), TABLET);
      await recT.start(); await pause(tp, 1200);
      await recT.tap(tp, 'table', tableCard(tp, 'Masa 05'), { hold: 1500 });
      await recT.tap(tp, 'add', dialog(tp).getByRole('button', { name: /Sipariş ekle/ }), { hold: 1500 });
      recT.mark('composer');
      await recT.tap(tp, 'cat', tp.locator('.category-tabs').getByRole('button', { name: 'Kahveler' }), { hold: 1100 });
      await recT.tap(tp, 'product', tp.locator('.staff-card', { hasText: 'Caffè Latte' }).first(), { hold: 1300 });
      recT.mark('options');
      const dlg = tp.getByRole('dialog');
      await recT.tap(tp, 'large', dlg.getByText(/^Büyük$/).first(), { hold: 700 });
      await recT.tap(tp, 'oat', dlg.getByText(/^Yulaf sütü$/).first(), { hold: 700 });
      await recT.tap(tp, 'more', dlg.getByRole('button', { name: 'Adedi artır' }), { hold: 900 });
      await recT.tap(tp, 'toCart', dlg.getByRole('button', { name: /Sepete ekle/ }), { hold: 1100 });
      await recT.tap(tp, 'cart', tp.locator('.staff-basket-open'), { hold: 1500 });
      recT.mark('cartOpen');
      // The owner's screen is recorded from the send on (a low-stock notification may come at any moment from here).
      const recO = new Recorder(op, join(OUT, 's6-sonra'), DESKTOP);
      await recO.start();
      const toast = op.getByTestId('notification-toast').first();
      let toastAt = 0;
      const seen = toast.waitFor({ timeout: 90000 }).then(async () => { toastAt = Date.now(); recO.mark('toast'); await toast.hover().catch(() => {}); }).catch(() => {});
      await recT.tap(tp, 'send', dlg.getByRole('button', { name: 'Siparişi gönder', exact: true }), { hold: 200 });
      await tp.getByText(/mutfağa gönderildi/).first().waitFor({ timeout: 15000 });
      recT.mark('sent'); recO.mark('sent');
      await pause(tp, 2600);
      await recT.stop();

      await pause(op, 600);
      await recO.tap(op, 'items', stockTab(op, 'Malzemeler'), { hold: 1200 });
      recO.mark('items');
      await itemCard(op, 'Yulaf sütü').locator('.stock-chip').waitFor({ timeout: 20000 }).catch(() => {});
      await itemCard(op, 'Yulaf sütü').evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'smooth' })); await pause(op, 900);
      recO.mark('card');
      await recO.look(op, 'card', itemCard(op, 'Yulaf sütü'), 3600);
      info.oatAfter = await itemCard(op, 'Yulaf sütü').innerText().catch(() => '');
      await seen;
      if (toastAt && await toast.isVisible().catch(() => false)) { await pause(op, 400); await recO.look(op, 'toast', toast, 3800); info.toast = await toast.innerText().catch(() => ''); }
      await op.mouse.move(640, 760); await pause(op, 400);
      await op.evaluate('scrollTo({ top: 0, behavior: "smooth" })'); await pause(op, 900);
      await recO.tap(op, 'products', stockTab(op, 'Ürünler'), { hold: 1400 });
      await bring(op, productRow(op, 'Caffè Latte'), 150);
      recO.mark('latte');
      await recO.look(op, 'latte', productRow(op, 'Caffè Latte'), 3800);
      info.latteAfter = await productRow(op, 'Caffè Latte').innerText().catch(() => '');
      await recO.stop(); }

    // ===== s7: a count =====
    console.log('Kayıt: s7-sayim');
    await op.evaluate('scrollTo(0, 0)'); await pause(op, 600);
    { const rec = new Recorder(op, join(OUT, 's7-sayim'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'tab', stockTab(op, 'Alış ve sayım'), { hold: 1500 });
      rec.mark('entries');
      await rec.tap(op, 'count', op.locator('.stock-action', { hasText: 'Sayım yap' }), { hold: 1400 });
      rec.mark('form');
      const d = dialog(op), milk = d.getByLabel('Süt sayılan miktar', { exact: true });
      await bringIn(op, milk, 260);
      await typeIn(op, rec, 'milk', milk, '20,5', { delay: 150 });
      await pause(op, 700);
      await rec.look(op, 'diff', d.locator('.stock-count-row', { has: op.getByLabel('Süt sayılan miktar', { exact: true }) }), 3000);
      await rec.tap(op, 'save', d.getByRole('button', { name: /^Sayımı kaydet/ }), { hold: 300 });
      await notice(op).waitFor({ timeout: 15000 });
      rec.mark('saved'); await pause(op, 800);
      await rec.look(op, 'tiles', op.locator('.stock-actions-grid'), 3600);
      await rec.stop(); }

    // ===== s8: Kârlılık and its "Düşük kâr" lines =====
    console.log('Kayıt: s8-karlilik');
    { const rec = new Recorder(op, join(OUT, 's8-karlilik'), DESKTOP);
      await rec.start(); await pause(op, 1000);
      await rec.tap(op, 'nav', op.locator('aside nav').getByRole('button', { name: 'Satış ve Raporlar', exact: true }), { hold: 1600 });
      const detail = op.getByRole('button', { name: /Detaylı göster/ });
      if (await detail.isVisible().catch(() => false)) await rec.tap(op, 'detail', detail, { hold: 1500 });
      await rec.tap(op, 'tab', op.locator('.report-tabs').getByText('Kârlılık', { exact: true }), { hold: 1800 });
      await op.locator('.kpi-row').first().waitFor({ timeout: 20000 }); await pause(op, 800);
      rec.mark('report');
      await rec.look(op, 'kpi', op.locator('.kpi-row').first(), 3200);
      await bring(op, op.locator('.profit-table'), 24, 1300);
      rec.mark('table');
      await rec.box('tableBefore', op.locator('.profit-table'));
      await rec.look(op, 'rows', op.locator('.profit-table table'), 4200);
      info.before = await op.locator('.profit-table').innerText().catch(() => '');
      await rec.tap(op, 'limits', op.getByRole('button', { name: 'Uyarı sınırları' }), { lead: 2200, hold: 1800 });
      rec.mark('limitsOpen');
      const d = dialog(op), drinks = d.getByLabel('İçecekler: en az kâr oranı (%)');
      await drinks.waitFor({ timeout: 15000 }); await pause(op, 400);
      await rec.look(op, 'groups', d.locator('.margin-groups'), 3400);
      await retype(op, rec, 'drinks', drinks, '80');
      await pause(op, 900);
      await rec.tap(op, 'save', d.getByRole('button', { name: 'Kaydet', exact: true }), { hold: 300 });
      await d.getByText(/Kaydedildi/).waitFor({ timeout: 15000 });
      rec.mark('saved'); await pause(op, 1800);
      await rec.tap(op, 'close', d.getByRole('button', { name: 'Kapat' }), { hold: 600 });
      await op.locator('.profit-low-chip').first().waitFor({ timeout: 20000 });
      await pause(op, 900);
      await bring(op, op.locator('.profit-table'), 24, 600);
      rec.mark('after');
      await rec.box('tableAfter', op.locator('.profit-table'));
      await rec.look(op, 'lows', op.locator('.profit-table table'), 4600);
      info.after = await op.locator('.profit-table').innerText().catch(() => '');
      await rec.stop(); }

    // ===== The thumbnail's phone (off camera): the owner's Stok → Malzemeler on the phone =====
    { const pctx = await k.phoneContext(); await pctx.addInitScript('window.__molaNoFinger = true'); await pctx.addInitScript(NO_HINTS);
      const pp = await pctx.newPage();
      await k.login(pp, 'isletme'); await pause(pp, 1200);
      await pp.getByRole('button', { name: /Daha fazla/ }).first().click(); await pause(pp, 900);
      await pp.getByRole('button', { name: /^Stok/ }).last().click(); await pause(pp, 1500);
      await pp.locator('.stock-items').first().waitFor({ timeout: 15000 }); await pause(pp, 1000);
      await pp.screenshot({ path: join(OUT, 'kapak-telefon.png') });
      await pctx.close(); }

    for (const s of [owner, waiter]) await s.ctx.close();
  } catch (e) {
    let n = 0;
    for (const b of [k.deskBrowser, k.phoneBrowser]) for (const c of b?.contexts() ?? []) for (const p of c.pages()) await p.screenshot({ path: join(BASE, `hata-${++n}.png`) }).catch(() => {});
    throw e;
  } finally {
    writeFileSync(join(OUT, 'bilgi.json'), JSON.stringify(info, null, 1));
    await k.close();
  }
}
await main();
