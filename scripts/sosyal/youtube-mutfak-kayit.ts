/*
 * YouTube E3 "Mutfak eğitimi" (training series, the kitchen's own screen): recordings of the REAL app on the kitchen display
 * (Mutfak modu, src/KitchenMode.tsx; edit: scripts/sosyal/youtube-mutfak-kurgu.ts). One run in story order on a fresh Mola
 * Merkez + demo café ("Mola Örnek Kafe", shared parts: scripts/sosyal/kayit-ortak.ts) in .local/sosyal/youtube/mutfak/run-<zaman>/.
 *
 * The run plays at lunch time on the recording clock (kit({ saat })). Off camera first: the demo's floor calmed, the owner's
 * stock set up as an owner does it in Stok (ingredients with what is on the shelf, recipes for Caffè Latte, Americano, Türk
 * Kahvesi, Künefe and Ev Yapımı Limonata), QR change window 30 s. Then the waiter's orders: Masa 04 at 12:02 (started by the
 * kitchen, so at 12:15 it is "13 dk · Gecikti") and Masa 11 at 12:08. The clips:
 *
 *   m1-giris     the kitchen display's sign-in: kullanıcı adı "mutfak", şifre, "Çalışma alanını aç" → Mutfak panosu; the
 *                screen and sound icons on the bar ("Sipariş sesini etkinleştir" tapped if the browser asks for it).
 *   m2-pano      the bar's counts, the three columns, Masa 04's card (Gecikti, options, the note).
 *   t3-gonder    the waiter's tablet (1180×820): Masa 05's basket → "Siparişi gönder".   + m3-yeni: the card arriving.
 *   m4-hazirla   Masa 04 "Hazır olarak işaretle" → Hazır, "Geri al"; Masa 05 "Hazırlamaya başla".   + t4-hazir: the waiter's
 *                tablet at the same time (the note "Masa 04 · #n hazır").
 *   m5-teslim    the waiter serves Masa 04 (off camera): the card leaves Hazır.
 *   q6-telefon   a guest at Masa 08 (phone, no pointer): "Siparişi gönder" → "30 sn içinde değiştirebilirsiniz".
 *                + m6-qr: the kitchen gets the card when the 30 s are over ("Misafir 1") → "Hazırlamaya başla".
 *   m7-degisti   the waiter changes Masa 10's Fırın Sütlaç to Kazandibi ("DEĞİŞTİ") and cancels Masa 03's order ("İPTAL").
 *   m8-iptal     Masa 08 being prepared; the guest asks to cancel (phone off camera) → "Müşteri iptal istiyor" →
 *                "İptali onayla" → "Bu üründen stok kullanıldı mı?" → "Evet, hazırlanmıştı (fire)".
 *   m9-stok      "Stok" → Malzemeler → "Sayım ve fire" → "Sayım yap" (Süt, Espresso çekirdeği) → "Sayımı kaydet"; "Fire
 *                kaydet" (Süt, 500 ml, Bozuldu) → "Fireyi kaydet" → "Mutfak panosu".
 *
 *   npx tsx scripts/sosyal/youtube-mutfak-kayit.ts            (needs `npm run build`; ~7 minutes)
 *
 * No pointer: every tap goes through Recorder.tap (box saved, a still lead-in the edit cuts). Kitchen display 1280×800 (2×),
 * waiter's tablet 1180×820 (2×), guest phone 390×844 (3×). Ports: café 3752, Mola Merkez 3797. Every process is stopped at the end.
 * Output: .local/sosyal/youtube/mutfak/kayit/<klip>/ (meta.json) and kayit/bilgi.json (order numbers, stock figures).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { DESKTOP, NO_HINTS, PASSWORD, PHONE, ROOT, Recorder, TABLET, kit, pause, typeIn, type StaffState } from './kayit-ortak';

const BASE = join(ROOT, '.local', 'sosyal', 'youtube', 'mutfak');
const OUT = join(BASE, 'kayit');
const run = join(BASE, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
/** A time of the Istanbul day `day` days from today's (real) date, as ms. */
function istanbul(day: number, hh: number, mm: number) {
  const d = new Date(Date.now() + 3 * 3600e3), start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + day * 86400e3;
  return start + (hh - 3) * 3600e3 + mm * 60e3;
}
const k = kit({ run, kafePort: 3752, merkezPort: 3797, saat: istanbul(0, 11, 40) });
mkdirSync(OUT, { recursive: true });
const info: Record<string, unknown> = {};

// ---------- Off-camera helpers ----------
type Option = { id: string; name: string; extra: number };
type Group = { id: string; name: string; required: boolean; options: Option[] };
type Line = { id: string; productId: string; quantity: number; name: string };
type State = Omit<StaffState, 'products' | 'orders'> & { products: { id: string; name: string; price: number; groups: Group[] }[];
  orders: (StaffState['orders'][number] & { tableName?: string; number: number; lines: Line[] })[] };
/** A signed-in request context of one of the demo's accounts (isletme, garson, mutfak). */
async function as(user: string) {
  const ctx = await k.deskBrowser.newContext(), page = await ctx.newPage();
  await k.login(page, user);
  return { req: page.request, close: () => ctx.close() };
}
const stateOf = async (req: APIRequestContext) => (await (await req.get(`${k.KAFE}/api/staff/state`)).json()) as State;
/** [product, quantity, option names, note]: a required choice without a named option takes its first. */
type Want = [string, number, string[]?, string?];
function cartLine(s: State, [name, quantity, opts = [], note]: Want) {
  const p = s.products.find(x => x.name === name);
  if (!p) throw new Error(`Ürün yok: ${name}`);
  const picked = p.groups.flatMap(g => { const o = g.options.find(o => opts.includes(o.name)) ?? (g.required ? g.options[0] : undefined); return o ? [{ g, o }] : []; });
  const unit = p.price + picked.reduce((n, x) => n + x.o.extra, 0);
  return { line: { productId: p.id, quantity, selections: picked.map(x => ({ groupId: x.g.id, optionId: x.o.id })), ...(note ? { note } : {}) }, total: unit * quantity };
}
/** The waiter's order, as the tablet sends it. */
async function order(table: string, wants: Want[]) {
  const w = await as('garson'), s = await stateOf(w.req), t = s.tables.find(x => x.name === table)!;
  const cart = wants.map(x => cartLine(s, x));
  await k.post(w.req, '/api/staff/orders', { requestId: randomUUID(), tableId: t.id, lines: cart.map(c => c.line), expectedTotal: cart.reduce((n, c) => n + c.total, 0) });
  await w.close();
}
const ordersOf = async (table: string) => { const api = await k.ownerApi(k.deskBrowser), s = await stateOf(api.req); await api.close(); return s.orders.filter(o => o.tableName === table && !['served', 'cancelled', 'rejected'].includes(o.status)); };
/** Kitchen steps (as the kitchen account) and "Teslim edildi" (as the waiter), off camera. */
async function advance(table: string, to: ('preparing' | 'ready' | 'served')[]) {
  for (const step of to) {
    const who = await as(step === 'served' ? 'garson' : 'mutfak'), s = await stateOf(who.req);
    for (const o of s.orders.filter(o => o.tableName === table && ['new', 'preparing', 'ready'].includes(o.status) && o.status !== step))
      await k.post(who.req, '/api/staff/status', { requestId: randomUUID(), orderId: o.id, version: o.version, status: step });
    await who.close();
  }
}

/** Every table waiting for cleaning cleaned (as the waiter does): the clips' tables take orders. */
async function cleanAll() {
  const w = await as('garson'), s = await stateOf(w.req) as unknown as { tables: { id: string; epoch: number; needsCleaning?: boolean }[] };
  for (const t of s.tables.filter(t => t.needsCleaning)) await k.post(w.req, '/api/staff/tables/clean', { requestId: randomUUID(), tableId: t.id, epoch: t.epoch });
  await w.close();
}

/** The owner's Stok, set up off camera: ingredients with what is on the shelf now, and five recipes. */
const ITEMS: { name: string; unit: 'g' | 'ml' | 'piece'; initial: number; min?: number }[] = [
  { name: 'Espresso çekirdeği', unit: 'g', initial: 2400, min: 500 }, { name: 'Süt', unit: 'ml', initial: 16000, min: 4000 },
  { name: 'Yulaf sütü', unit: 'ml', initial: 4000, min: 1000 }, { name: 'Türk kahvesi', unit: 'g', initial: 1200, min: 250 },
  { name: 'Tel kadayıf', unit: 'g', initial: 2000, min: 500 }, { name: 'Künefe peyniri', unit: 'g', initial: 1800, min: 500 },
  { name: 'Dondurma', unit: 'g', initial: 2500, min: 500 }, { name: 'Limon', unit: 'piece', initial: 40, min: 10 },
];
async function setUpStock() {
  const api = await k.ownerApi(k.deskBrowser), req = api.req, ids: Record<string, string> = {};
  for (const i of ITEMS) { const r = await k.post(req, '/api/staff/stock/items', { name: i.name, unit: i.unit, min: i.min ?? null, initial: i.initial }) as { item: { id: string } }; ids[i.name] = r.item.id; }
  const s = await stateOf(req), product = (name: string) => s.products.find(p => p.name === name)!;
  const opt = (p: string, group: string, option: string) => { const g = product(p).groups.find(x => x.name === group)!; return { groupId: g.id, optionId: g.options.find(o => o.name === option)!.id }; };
  const recipe = async (name: string, items: [string, number][], options: unknown[] = []) =>
    k.post(req, '/api/staff/stock/recipes', { productId: product(name).id, mode: 'recipe', items: items.map(([n, amount]) => ({ itemId: ids[n], amount })), options });
  await recipe('Caffè Latte', [['Espresso çekirdeği', 18], ['Süt', 200]], [{ ...opt('Caffè Latte', 'Süt tercihi', 'Yulaf sütü'), replace: [{ from: ids['Süt'], to: ids['Yulaf sütü'] }] }]);
  await recipe('Americano', [['Espresso çekirdeği', 18]]);
  await recipe('Türk Kahvesi', [['Türk kahvesi', 7]]);
  await recipe('Künefe', [['Tel kadayıf', 60], ['Künefe peyniri', 80]], [{ ...opt('Künefe', 'Servis tercihi', 'Dondurmalı'), add: [{ itemId: ids['Dondurma'], amount: 60 }] }]);
  await recipe('Ev Yapımı Limonata', [['Limon', 2]]);
  await api.close();
}
/** What Stok expects on the shelf now (base units), as the kitchen reads it. */
async function expected() {
  const m = await as('mutfak'), r = await (await m.req.get(`${k.KAFE}/api/staff/stock`)).json() as { items: { name: string; stock: number }[] };
  await m.close();
  return Object.fromEntries(r.items.map(i => [i.name, i.stock]));
}

// ---------- On the screens ----------
const kcard = (page: Page, table: string) => page.locator('.kitchen-card', { has: page.locator('h3', { hasText: new RegExp(`^${table}$`) }) }).first();
const tcard = (page: Page, table: string) => page.locator('.table-card', { has: page.locator('h3', { hasText: new RegExp(`^${table}$`) }) }).first();
const dialog = (page: Page) => page.getByRole('dialog').last();
const nav = (page: Page, name: string) => page.locator('aside nav').getByRole('button', { name: new RegExp(`^${name}`) });
/** A native select: the tap on the field is recorded, then the choice (its list is not in the picture). */
async function choose(page: Page, rec: Recorder, name: string, select: Locator, label: string) {
  await select.scrollIntoViewIfNeeded(); await pause(page, 300);
  const box = await select.boundingBox(); const t = Date.now() / 1000; rec.taps.push({ name, box: box!, on: t - .2, tap: t });
  await select.focus(); await pause(page, 500);
  await select.selectOption({ label });
  await pause(page, 1200);
}

/**
 * Works around an app bug seen while recording (reported, not fixed here): after "Sayımı kaydet" / "Fireyi kaydet" the
 * kitchen's green note also shows "Giderlerde gör" (src/StockEntries.tsx useSend hands the API answer to onSaved as its
 * second argument, which CountForm and WasteForm pass on as the expense id; src/Stock.tsx then shows the link). A count or
 * a fire writes no expense and the kitchen has no Giderler, so the link is hidden on the kitchen display.
 */
const HIDE_EXPENSE_LINK = `document.addEventListener('DOMContentLoaded', function () { var s = document.createElement('style'); s.textContent = '.stock-workspace .place-link{display:none!important}'; document.head.appendChild(s); });`;

async function main() {
  await k.launch();
  const desk = k.deskBrowser;
  try {
    await k.startServers();
    await k.prepareMenu(desk, { waiterApproval: false, changeSeconds: 30 });
    await k.calm(desk, false);
    await k.setPrefs(desk, { qrOpen: true });
    await cleanAll();
    await setUpStock();
    console.log('Stok hazır:', JSON.stringify(await expected()));

    // ===== Off camera: the lunch's first orders =====
    await k.setClock(istanbul(0, 12, 2));
    await order('Masa 04', [['Türk Kahvesi', 2, ['Orta'], 'Biri az köpüklü'], ['Künefe', 1, ['Dondurmalı']]]);
    await advance('Masa 04', ['preparing']);
    await k.setClock(istanbul(0, 12, 8));
    await order('Masa 11', [['Caffè Latte', 1, ['Büyük', 'Yulaf sütü']], ['San Sebastian', 1]]);
    await advance('Masa 11', ['preparing']);
    await k.setClock(istanbul(0, 12, 15));

    // The kitchen display: signed in once (and out) off camera, so the recorded sign-in is the everyday one.
    const ctx = await k.desktopContext(); await ctx.addInitScript(NO_HINTS); await ctx.addInitScript(HIDE_EXPENSE_LINK);
    const page = await ctx.newPage();
    await k.login(page, 'mutfak');
    await page.getByRole('button', { name: 'Çıkış yap' }).first().click();
    await page.getByLabel('Kullanıcı adı', { exact: true }).waitFor().catch(async e => { await page.screenshot({ path: join(BASE, 'hata.png') }); throw e; });
    await page.goto(`${k.KAFE}/`);
    await page.getByLabel('Kullanıcı adı', { exact: true }).waitFor(); await pause(page, 1200);

    // ===== m1: sign in =====
    console.log('Kayıt: m1-giris');
    let rec = new Recorder(page, join(OUT, 'm1-giris'), DESKTOP);
    await rec.start(); await pause(page, 1800);
    await typeIn(page, rec, 'user', page.getByLabel('Kullanıcı adı', { exact: true }), 'mutfak', { delay: 90 });
    await typeIn(page, rec, 'pass', page.getByLabel('Şifre', { exact: true }), PASSWORD, { delay: 60 });
    await rec.tap(page, 'open', page.getByRole('button', { name: 'Çalışma alanını aç' }), { hold: 300 });
    await page.locator('.kitchen-board').waitFor({ timeout: 20000 });
    rec.mark('in'); await pause(page, 2600);
    const sound = page.locator('.kitchen-sound-compact .sound-icon');
    info.soundAtSignIn = await sound.getAttribute('aria-label');
    console.log('  ses:', info.soundAtSignIn, '· ekran:', await page.locator('.kitchen-awake .sound-icon').getAttribute('aria-label'));
    await rec.look(page, 'tools', page.locator('.kitchen-bar-tools .kitchen-tools'), 7400);
    await pause(page, 800);
    await rec.stop();

    // ===== m2: the board =====
    console.log('Kayıt: m2-pano');
    rec = new Recorder(page, join(OUT, 'm2-pano'), DESKTOP);
    await rec.start(); await pause(page, 1500);
    await rec.look(page, 'counts', page.locator('.kitchen-bar-counts'), 3200);
    await rec.look(page, 'board', page.locator('.kitchen-board'), 3400);
    const c4 = kcard(page, 'Masa 04');
    await rec.look(page, 'head', c4.locator('.order-head'), 2800);
    await rec.look(page, 'late', c4.locator('.order-meta'), 3400);
    await rec.look(page, 'lines', c4.locator('.order-lines'), 3600);
    await pause(page, 600);
    await rec.stop();

    // ===== t3 + m3: a new order from the waiter's tablet =====
    const tablet = await k.staffScreen('garson', 'tablet'), tp = tablet.page;
    await tp.evaluate('scrollTo(0, 0)');
    await tcard(tp, 'Masa 05').click(); await pause(tp, 1200);
    await dialog(tp).getByRole('button', { name: /Sipariş ekle/ }).click(); await pause(tp, 1500);
    await tp.locator('.staff-card', { hasText: 'Türk Kahvesi' }).first().click(); await pause(tp, 900);
    await dialog(tp).getByText(/^Sade$/).first().click(); await pause(tp, 300);
    await dialog(tp).getByRole('button', { name: 'Adedi artır' }).click(); await pause(tp, 300);
    await dialog(tp).getByRole('button', { name: /Sepete ekle/ }).click(); await pause(tp, 900);
    await tp.getByRole('button', { name: /^Fıstıklı Baklava · bir adet ekle/ }).click(); await pause(tp, 900);
    await tp.locator('.staff-basket-open').click(); await pause(tp, 1500);
    console.log('Kayıt: t3-gonder / m3-yeni');
    rec = new Recorder(page, join(OUT, 'm3-yeni'), DESKTOP);
    let recT = new Recorder(tp, join(OUT, 't3-gonder'), TABLET);
    await rec.start(); await recT.start(); await pause(tp, 1500);
    await recT.tap(tp, 'send', dialog(tp).getByRole('button', { name: 'Siparişi gönder', exact: true }), { hold: 200 });
    await tp.getByText(/mutfağa gönderildi/).first().waitFor({ timeout: 15000 });
    recT.mark('sent');
    await kcard(page, 'Masa 05').waitFor({ timeout: 20000 });
    rec.mark('ticket'); await pause(page, 900);
    await rec.look(page, 'card', kcard(page, 'Masa 05'), 3800);
    await rec.look(page, 'count', page.locator('.kitchen-bar-counts .count-new'), 2400);
    await recT.stop(); await rec.stop();
    info.masa05 = (await ordersOf('Masa 05')).map(o => o.number);
    await nav(tp, 'Masalar').click(); await pause(tp, 1200); await tp.evaluate('scrollTo(0, 0)'); await pause(tp, 800);

    // ===== m4 + t4: ready, "Geri al", start =====
    console.log('Kayıt: m4-hazirla / t4-hazir');
    rec = new Recorder(page, join(OUT, 'm4-hazirla'), DESKTOP);
    recT = new Recorder(tp, join(OUT, 't4-hazir'), TABLET);
    await rec.start(); await recT.start(); await pause(page, 1200);
    await rec.tap(page, 'ready', kcard(page, 'Masa 04').getByRole('button', { name: /Hazır olarak işaretle/ }), { hold: 300 });
    rec.mark('readyDone'); recT.mark('readyDone');
    // The tablet's note ("Masa 04 · #n hazır"), boxed for the edit while the kitchen goes on.
    const toastSeen = (async () => {
      const toast = tp.locator('.toast').first();
      await toast.waitFor({ timeout: 15000 });
      const box = await toast.boundingBox(), on = Date.now() / 1000;
      recT.mark('toast'); await pause(tp, 2800);
      recT.taps.push({ name: 'toast', box: box!, on, off: Date.now() / 1000 });
    })();
    const undo = kcard(page, 'Masa 04').locator('.kitchen-undo');
    await undo.waitFor({ timeout: 10000 });
    await rec.look(page, 'undo', undo, 3000);
    await toastSeen;
    await pause(page, 1600);
    await rec.tap(page, 'start', kcard(page, 'Masa 05').getByRole('button', { name: /Hazırlamaya başla/ }), { hold: 300 });
    rec.mark('started'); await pause(page, 2600);
    await recT.stop(); await rec.stop();

    // ===== m5: the waiter serves Masa 04 =====
    console.log('Kayıt: m5-teslim');
    await pause(page, 4000);
    rec = new Recorder(page, join(OUT, 'm5-teslim'), DESKTOP);
    await rec.start(); await pause(page, 1200);
    await rec.look(page, 'ready', kcard(page, 'Masa 04'), 3200);
    rec.mark('wait0');
    await advance('Masa 04', ['served']);
    await kcard(page, 'Masa 04').waitFor({ state: 'detached', timeout: 20000 });
    rec.mark('gone'); await pause(page, 2600);
    await rec.stop();

    // ===== Off camera: the kitchen goes on =====
    await advance('Masa 11', ['ready', 'served']);
    await advance('Masa 05', ['ready', 'served']);
    await pause(page, 3000);

    // ===== q6 + m6: a QR order from a guest's phone =====
    const api = await k.ownerApi(desk), token = (await stateOf(api.req)).tables.find(t => t.name === 'Masa 08')!.token; await api.close();
    const gctx = await k.phoneContext(); await gctx.addInitScript('window.__molaNoFinger = true');
    const gp = await gctx.newPage();
    await k.openMenu(gp, token);
    const add = async (name: string) => {
      await gp.locator('.product-card', { hasText: name }).first().locator('.add-circle').click(); await pause(gp, 800);
      const inDialog = gp.getByRole('button', { name: /Sepete ekle/ });
      if (await inDialog.isVisible().catch(() => false)) { await inDialog.click(); await pause(gp, 600); }
    };
    await add('Ev Yapımı Limonata'); await add('Ev Yapımı Limonata'); await add('Fırın Sütlaç');
    await gp.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click(); await pause(gp, 1200);
    console.log('Kayıt: q6-telefon / m6-qr');
    const recP = new Recorder(gp, join(OUT, 'q6-telefon'), PHONE);
    rec = new Recorder(page, join(OUT, 'm6-qr'), DESKTOP);
    await recP.start(); await rec.start(); await pause(gp, 1600);
    await recP.tap(gp, 'send', gp.getByRole('button', { name: 'Siparişi gönder', exact: true }), { hold: 100 });
    await gp.getByText(/Siparişiniz alındı|Afiyet olsun/).first().waitFor({ timeout: 15000 });
    recP.mark('sent'); rec.mark('sent'); await pause(gp, 600);
    await recP.look(gp, 'window', gp.getByText(/sn içinde değiştirebilirsiniz/).first(), 3000);
    await recP.stop();
    rec.mark('wait0');
    await kcard(page, 'Masa 08').waitFor({ timeout: 60000 });
    rec.mark('ticket'); await pause(page, 900);
    await rec.look(page, 'card', kcard(page, 'Masa 08'), 3400);
    await rec.look(page, 'guest', kcard(page, 'Masa 08').locator('.order-meta'), 2800);
    await rec.tap(page, 'start', kcard(page, 'Masa 08').getByRole('button', { name: /Hazırlamaya başla/ }), { hold: 300 });
    rec.mark('started'); await pause(page, 2200);
    await rec.stop();
    // The guest's success window closed and Siparişlerim open (for the cancel request later).
    await gp.getByRole('button', { name: 'Siparişimi takip et' }).click(); await pause(gp, 1200);
    info.masa08 = (await ordersOf('Masa 08')).map(o => o.number);

    // ===== Off camera: two waiter orders waiting =====
    await order('Masa 10', [['Demleme Çay', 2], ['Fırın Sütlaç', 1]]);
    await pause(page, 1500);
    await order('Masa 03', [['Profiterol', 1], ['Ayran', 1]]);
    await kcard(page, 'Masa 03').waitFor({ timeout: 20000 });
    await pause(page, 5000);

    // ===== m7: a changed and a cancelled order =====
    console.log('Kayıt: m7-degisti');
    rec = new Recorder(page, join(OUT, 'm7-degisti'), DESKTOP);
    await rec.start(); await pause(page, 1500);
    rec.mark('wait0');
    { const w = await as('garson'), s = await stateOf(w.req), o = s.orders.find(o => o.tableName === 'Masa 10' && o.status === 'new')!;
      const old = o.lines.find(l => l.name === 'Fırın Sütlaç')!, fresh = cartLine(s, ['Kazandibi', 1]);
      const others = o.lines.filter(l => l.id !== old.id).map(l => cartLine(s, [l.name, l.quantity]).total);
      await k.post(w.req, '/api/staff/orders/change', { requestId: randomUUID(), orderId: o.id, version: o.version, lineId: old.id, line: fresh.line, expectedTotal: fresh.total + others.reduce((n, x) => n + x, 0) });
      await w.close(); }
    await page.locator('.kitchen-cancel-strip').first().waitFor({ timeout: 20000 });
    rec.mark('changed'); await pause(page, 900);
    await rec.look(page, 'strip1', page.locator('.kitchen-cancel-strip').first(), 3400);
    await rec.look(page, 'cardChange', kcard(page, 'Masa 10'), 3400);
    rec.mark('wait1');
    { const w = await as('garson'), s = await stateOf(w.req), o = s.orders.find(o => o.tableName === 'Masa 03' && o.status === 'new')!;
      await k.post(w.req, '/api/staff/orders/cancel', { requestId: randomUUID(), orderId: o.id, version: o.version, reason: 'Müşteri vazgeçti' });
      await w.close(); }
    await kcard(page, 'Masa 03').waitFor({ state: 'detached', timeout: 20000 });
    rec.mark('cancelled'); await pause(page, 900);
    await rec.look(page, 'strip2', page.locator('.kitchen-cancel-strip').first(), 3800);
    await pause(page, 600);
    await rec.stop();
    // Off camera: Masa 10 made and served; the strips leave (30 s).
    await advance('Masa 10', ['preparing', 'ready', 'served']);
    await page.locator('.kitchen-cancel-strip').first().waitFor({ state: 'detached', timeout: 45000 }).catch(() => {});
    await pause(page, 1500);

    // ===== m8: the guest asks to cancel what the kitchen started =====
    console.log('Kayıt: m8-iptal');
    rec = new Recorder(page, join(OUT, 'm8-iptal'), DESKTOP);
    await rec.start(); await pause(page, 1200);
    await rec.look(page, 'card', kcard(page, 'Masa 08'), 2400);
    rec.mark('wait0');
    await gp.getByRole('button', { name: /Siparişi iptal et/ }).first().click(); await pause(gp, 700);
    await gp.getByRole('button', { name: /Evet, iptal et/ }).first().click();
    const ask = kcard(page, 'Masa 08').locator('.kitchen-cancellation');
    await ask.waitFor({ timeout: 20000 });
    rec.mark('asked'); await pause(page, 900);
    await rec.look(page, 'ask', ask, 3400);
    await rec.tap(page, 'approve', ask.getByRole('button', { name: 'İptali onayla' }), { hold: 1200 });
    const box = kcard(page, 'Masa 08').locator('.stock-answer-box');
    await box.waitFor({ timeout: 10000 });
    await rec.look(page, 'question', box, 3400);
    await rec.tap(page, 'yes', box.getByRole('button', { name: 'Evet, hazırlanmıştı (fire)' }), { hold: 300 });
    await kcard(page, 'Masa 08').waitFor({ state: 'detached', timeout: 20000 });
    rec.mark('done'); await pause(page, 2400);
    await rec.stop();
    await gctx.close();

    // ===== m9: stock count and fire =====
    // The İPTAL strip of m8 leaves first (30 s).
    await page.locator('.kitchen-cancel-strip').first().waitFor({ state: 'detached', timeout: 45000 }).catch(() => {});
    await pause(page, 1500);
    const before = await expected();
    info.stockBefore = before;
    const milkL = Math.floor(before['Süt'] / 100 - 4) / 10, beansKg = Math.floor(before['Espresso çekirdeği'] / 100 - 1) / 10;
    info.counted = { milkL, beansKg };
    console.log('Kayıt: m9-stok', JSON.stringify(info.counted));
    rec = new Recorder(page, join(OUT, 'm9-stok'), DESKTOP);
    await rec.start(); await pause(page, 1200);
    await rec.tap(page, 'stok', page.locator('.kitchen-bar-btn', { hasText: 'Stok' }), { hold: 1800 });
    rec.mark('items');
    await page.locator('.stock-workspace').waitFor({ timeout: 10000 }); await pause(page, 1200);
    await rec.look(page, 'list', page.locator('.stock-workspace'), 3200);
    await rec.tap(page, 'tab', page.locator('.stock-tabs').getByText('Sayım ve fire'), { hold: 1400 });
    await rec.tap(page, 'count', page.locator('.stock-action', { hasText: 'Sayım yap' }), { hold: 1400 });
    rec.mark('countForm');
    await typeIn(page, rec, 'milk', dialog(page).getByLabel('Süt sayılan miktar', { exact: true }), String(milkL).replace('.', ','), { delay: 140 });
    await typeIn(page, rec, 'beans', dialog(page).getByLabel('Espresso çekirdeği sayılan miktar', { exact: true }), String(beansKg).replace('.', ','), { delay: 140 });
    await pause(page, 600);
    await rec.look(page, 'diff', dialog(page).locator('.stock-count-row', { hasText: 'Süt' }).first(), 2600);
    await rec.tap(page, 'saveCount', dialog(page).getByRole('button', { name: /Sayımı kaydet/ }), { hold: 300 });
    await page.getByText(/Sayım kaydedildi/).first().waitFor({ timeout: 15000 });
    rec.mark('counted'); await pause(page, 2200);
    await rec.tap(page, 'waste', page.locator('.stock-action', { hasText: 'Fire kaydet' }), { hold: 1400 });
    rec.mark('wasteForm');
    await choose(page, rec, 'item', dialog(page).getByLabel('Malzeme *', { exact: true }), 'Süt');
    await typeIn(page, rec, 'amount', dialog(page).getByLabel('Atılan miktar *', { exact: true }), '500', { delay: 140 });
    await pause(page, 600);
    await rec.look(page, 'reason', dialog(page).locator('label.stock-field', { hasText: 'Neden' }).locator('select'), 2400);
    await rec.tap(page, 'saveWaste', dialog(page).getByRole('button', { name: 'Fireyi kaydet' }), { hold: 300 });
    await page.getByText(/fire kaydedildi/).first().waitFor({ timeout: 15000 });
    rec.mark('wasted'); await pause(page, 1200);
    await rec.look(page, 'recent', page.locator('.stock-panel[aria-label="Son hareketler"]'), 3000);
    await rec.tap(page, 'back', page.locator('.kitchen-bar-btn', { hasText: 'Mutfak panosu' }), { hold: 1800 });
    rec.mark('board'); await pause(page, 800);
    await rec.stop();
    info.stockAfter = await expected();
    await tablet.ctx.close(); await ctx.close();
  } catch (e) {
    for (const b of [k.deskBrowser, k.phoneBrowser]) for (const c of b?.contexts() ?? []) for (const [i, p] of c.pages().entries()) await p.screenshot({ path: join(BASE, `hata-${b === k.phoneBrowser ? 'tel' : 'ekran'}-${i}.png`) }).catch(() => {});
    throw e;
  } finally {
    writeFileSync(join(OUT, 'bilgi.json'), JSON.stringify(info, null, 1));
    await k.close();
  }
}
await main();
