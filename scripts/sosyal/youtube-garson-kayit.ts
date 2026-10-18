/*
 * YouTube E1 "Garson eğitimi" (training series, the waiter's own screen): recordings of the REAL app on the waiter's tablet
 * (edit: scripts/sosyal/youtube-garson-kurgu.ts). One continuous run in story order on a fresh Mola Merkez + demo café
 * ("Mola Örnek Kafe", shared parts: scripts/sosyal/kayit-ortak.ts) in .local/sosyal/youtube/garson/run-<zaman>/.
 *
 * The demo's live floor keeps its mixed table states (Boş, Yeni sipariş, Hazırlanıyor, Servise hazır, Teslim edildi, Temizlik
 * bekliyor) for the Masalar overview; only its waiting QR approvals, cancel requests and calls are answered first, so every
 * notice on the tablet is the clip's own. Garson onayı is on (Ayarlar → Sipariş ve onay), the cash day open.
 *
 *   g1-giris     sign-in page: kullanıcı adı, şifre, "Çalışma alanını aç" → Masalar; "Ses kapalı · açmak için dokunun".
 *   g2-masalar   Masalar: the table cards by section (İç salon, Bahçe, Teras) and their states.
 *   g3-siparis   Masa 05 → "Sipariş ekle" → Sipariş al: Kahveler, Türk Kahvesi (Orta, 2 adet, not), search "san" → San
 *                Sebastian → sepet → "Siparişi gönder".  + g3-mutfak: the kitchen screen receiving it.
 *   g4-onay      a guest's QR order on Masa 14 (guest phone off camera) → "QR sipariş onayları" → "Onayla ve mutfağa gönder".
 *   g5-cagri     the Masa 05 guest's "Garson çağır" → the call on the tablet → "Tamam".
 *   g6-hazir     the kitchen marks Masa 05's order ready (off camera) → note and "Servise hazır" count → "Teslim edildi".
 *   g7-ekle      Masa 05 (open bill) → "Sipariş ekle" → 2 × Demleme Çay with "+" → "Gönder".
 *   g8-tasi      Masa 05 → "Taşı / birleştir" → Masa 08 → "Hesabı taşı".
 *   g9-hesap     the Masa 08 guest asks for the bill (Kart) → "Hesap · Kart" on the tablet → "Tamam"; the cashier takes the
 *                payment (off camera) → Masa 08 "Temizlik bekliyor" → "Temizlendi · Masayı hazırla".
 *
 *   npx tsx scripts/sosyal/youtube-garson-kayit.ts            (needs `npm run build`; ~5 minutes)
 *
 * No pointer: every tap goes through Recorder.tap (box saved, a still lead-in the edit cuts). Waiter = landscape tablet
 * 1180×820 (2×), kitchen screen 1280×800 (2×). Ports: café 3732, Mola Merkez 3799. Every process is stopped at the end.
 * Output: .local/sosyal/youtube/garson/kayit/<klip>/ (meta.json) and kayit/bilgi.json (order numbers, table states).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { DESKTOP, NO_HINTS, PASSWORD, ROOT, Recorder, TABLET, kit, pause, smoothScroll, typeIn, type StaffState } from './kayit-ortak';

const BASE = join(ROOT, '.local', 'sosyal', 'youtube', 'garson');
const OUT = join(BASE, 'kayit');
const run = join(BASE, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const k = kit({ run, kafePort: 3732, merkezPort: 3799 });
mkdirSync(OUT, { recursive: true });
const info: Record<string, unknown> = {};

// ---------- Off-camera helpers ----------
type Order = StaffState['orders'][number] & { number?: number; tableName?: string };
const ordersOf = async (browser: Browser, table: string) => { const api = await k.ownerApi(browser), s = await k.state(api.req); await api.close(); return (s.orders as Order[]).filter(o => o.tableName === table); };
/** The kitchen's steps through the owner's API (the kitchen screen is not on camera then). */
async function advance(browser: Browser, table: string, to: ('preparing' | 'ready' | 'served')[]) {
  const api = await k.ownerApi(browser);
  for (const step of to) {
    const s = await k.state(api.req);
    for (const o of (s.orders as Order[]).filter(o => o.tableName === table && !['served', 'cancelled', 'rejected', 'awaiting_approval'].includes(o.status) && o.status !== step))
      await k.post(api.req, '/api/staff/status', { requestId: randomUUID(), orderId: o.id, version: o.version, status: step });
  }
  await api.close();
}
async function tableToken(browser: Browser, name: string) { const api = await k.ownerApi(browser), s = await k.state(api.req); await api.close(); return s.tables.find(t => t.name === name)!.token; }
/** A guest's phone at a table (never on camera): the menu by its QR address. */
async function guest(browser: Browser, table: string) {
  const ctx = await k.phoneContext(), page = await ctx.newPage();
  await k.openMenu(page, await tableToken(browser, table));
  return { ctx, page };
}
async function guestOrder(browser: Browser, table: string) {
  const g = await guest(browser, table), page = g.page;
  await page.locator('.product-card', { hasText: 'Ev Yapımı Limonata' }).first().locator('.add-circle').click(); await pause(page, 700);
  const add = page.getByRole('button', { name: /Sepete ekle/ });
  if (await add.isVisible().catch(() => false)) { await add.click(); await pause(page, 500); }
  await page.locator('.product-card', { hasText: 'Fırın Sütlaç' }).first().locator('.add-circle').click(); await pause(page, 700);
  if (await add.isVisible().catch(() => false)) { await add.click(); await pause(page, 500); }
  await page.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click(); await pause(page, 600);
  await page.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await page.getByText(/onayına gönderildi/).first().waitFor();
  await g.ctx.close();
}
async function guestCall(browser: Browser, table: string, bill = false) {
  const g = await guest(browser, table), page = g.page;
  await page.evaluate('scrollTo(0, 0)'); await pause(page, 400);
  if (bill) {
    await page.getByRole('button', { name: 'Hesabı iste' }).click(); await pause(page, 500);
    await page.getByRole('group', { name: 'Nasıl ödeyeceksiniz?' }).getByRole('button', { name: 'Kart' }).click();
    await page.getByRole('button', { name: 'Hesap istendi' }).waitFor();
  } else {
    await page.getByRole('button', { name: 'Garson çağır' }).click();
    await page.getByRole('button', { name: 'Garson çağrıldı' }).waitFor();
  }
  await g.ctx.close();
}
/** The cashier takes the whole bill by card (off camera; the waiter never takes payments). */
async function cashierPays(browser: Browser, table: string) {
  const ctx = await browser.newContext(), p = await ctx.newPage();
  await k.login(p, 'kasiyer');
  const s = await (await p.request.get(`${k.KAFE}/api/staff/state`)).json() as { paymentContext: unknown; tables: { name: string; account: { id: string; version: number; balance: number } | null }[] };
  const a = s.tables.find(t => t.name === table)!.account!;
  await k.post(p.request, '/api/staff/payments', { requestId: randomUUID(), paymentContext: s.paymentContext, accountId: a.id, version: a.version, method: 'card', amount: a.balance, tendered: a.balance });
  await ctx.close();
}
/** A table whose bill is open but empty (the demo's cancelled order: "Sipariş yok · ₺0") closed, as the counter does. */
async function closeEmpty(browser: Browser) {
  const api = await k.ownerApi(browser), s = await k.state(api.req) as unknown as { tables: { name: string; account: { id: string; total: number; balance: number } | null }[] };
  for (const t of s.tables) if (t.account && !t.account.total && !t.account.balance) await k.post(api.req, '/api/staff/close-empty', { requestId: randomUUID(), accountId: t.account.id });
  await api.close();
}
/**
 * Works around an app bug seen while recording: after "Siparişi gönder" the sent basket stays in sessionStorage (the Composer
 * unmounts before its effect removes it), so the same table's Sipariş al opened again shows the old lines. Cleared off camera.
 */
const forgetBasket = (page: Page) => page.evaluate(`for (const key of Object.keys(sessionStorage)) if (key.startsWith('mola-staff-basket:') && !key.endsWith(':last-table')) sessionStorage.removeItem(key)`);
async function tableStates(browser: Browser) { const api = await k.ownerApi(browser), s = await k.state(api.req); await api.close(); return Object.fromEntries(s.tables.map(t => [t.name, t.needsCleaning ? 'temizlik' : t.account ? 'açık' : 'boş'])); }

// ---------- On the tablet ----------
const nav = (page: Page, name: string) => page.locator('aside nav').getByRole('button', { name: new RegExp(`^${name}`) });
const card = (page: Page, table: string) => page.locator('.table-card', { has: page.locator('h3', { hasText: new RegExp(`^${table}$`) }) }).first();
/** Smoothly scrolls the page so that `y` (page px) comes to `top` px under the window's top. */
async function scrollTo(page: Page, y: number, top = 24, ms = 1100) { const now = await page.evaluate('scrollY') as number; await smoothScroll(page, y - top - now, ms); await pause(page, 300); }
const pageY = async (page: Page, sel: string) => page.locator(sel).first().evaluate(e => e.getBoundingClientRect().top + scrollY);
async function toMasalar(page: Page) { await nav(page, 'Masalar').click(); await pause(page, 900); await page.evaluate('scrollTo(0, 0)'); await pause(page, 500); }
/** The table grid in sight (its heading "Masa görünümü" near the top). */
async function toGrid(page: Page, rec?: Recorder) { await scrollTo(page, await page.locator('h2, h3', { hasText: 'Masa görünümü' }).first().evaluate(e => e.getBoundingClientRect().top + scrollY), 20); rec?.mark('grid'); await pause(page, 500); }

async function main() {
  const phone = await k.launch(); void phone;
  const desk = k.deskBrowser;
  try {
    await k.startServers();
    await k.prepareMenu(desk, { waiterApproval: true, changeSeconds: 0 });
    await k.calm(desk, false, { keepOrders: true });
    await closeEmpty(desk);
    info.before = await tableStates(desk);
    for (const t of ['Masa 05', 'Masa 08', 'Masa 14']) if ((info.before as Record<string, string>)[t] !== 'boş') throw new Error(`${t} boş değil: ${(info.before as Record<string, string>)[t]}`);
    console.log('Masalar:', JSON.stringify(info.before));

    // The waiter's tablet: signed in once (and out) off camera, so the recorded sign-in is the everyday one.
    const tctx = await k.tabletContext(); await tctx.addInitScript(NO_HINTS);
    const page = await tctx.newPage();
    await k.login(page, 'garson');
    await page.getByRole('button', { name: 'Çıkış yap' }).first().click();
    await page.getByLabel('Kullanıcı adı', { exact: true }).waitFor().catch(async e => { await page.screenshot({ path: join(BASE, 'hata.png') }); throw e; });
    await page.goto(`${k.KAFE}/`);
    await page.getByLabel('Kullanıcı adı', { exact: true }).waitFor(); await pause(page, 1200);

    // ===== g1: sign in =====
    console.log('Kayıt: g1-giris');
    let rec = new Recorder(page, join(OUT, 'g1-giris'), TABLET);
    await rec.start(); await pause(page, 1800);
    await typeIn(page, rec, 'user', page.getByLabel('Kullanıcı adı', { exact: true }), 'garson', { delay: 90 });
    await typeIn(page, rec, 'pass', page.getByLabel('Şifre', { exact: true }), PASSWORD, { delay: 60 });
    await rec.tap(page, 'open', page.getByRole('button', { name: 'Çalışma alanını aç' }), { hold: 300 });
    await card(page, 'Masa 01').waitFor({ timeout: 20000 });
    rec.mark('in'); await pause(page, 2200);
    const sound = page.getByText(/Ses kapalı/).first();
    if (await sound.isVisible().catch(() => false)) { await rec.tap(page, 'sound', sound, { lead: 1600, hold: 1400 }); rec.mark('soundOn'); }
    await pause(page, 1200);
    await rec.stop();

    // ===== g2: Masalar =====
    console.log('Kayıt: g2-masalar');
    rec = new Recorder(page, join(OUT, 'g2-masalar'), TABLET);
    await rec.start(); await pause(page, 1500);
    await toGrid(page, rec); await pause(page, 3000);
    for (const [mark, heading] of [['bahce', 'Bahçe masaları'], ['teras', 'Teras masaları']] as const) {
      const y = await page.getByRole('heading', { name: heading }).first().evaluate(e => e.getBoundingClientRect().top + scrollY).catch(() => 0);
      if (y) { await scrollTo(page, y, 20, 1300); rec.mark(mark); await pause(page, 3400); }
    }
    await pause(page, 600);
    await rec.stop();

    // ===== g3: an order at Masa 05 (+ the kitchen screen) =====
    console.log('Kayıt: g3-siparis');
    // The kitchen has started the demo's waiting orders: the new ticket comes first in "Yeni sipariş".
    for (const t of ['Masa 10', 'Masa 12']) await advance(desk, t, ['preparing']);
    const kitchen = await k.staffScreen('mutfak', 'desktop');
    await toGrid(page);
    rec = new Recorder(page, join(OUT, 'g3-siparis'), TABLET);
    const recK = new Recorder(kitchen.page, join(OUT, 'g3-mutfak'), DESKTOP);
    await rec.start(); await recK.start(); await pause(page, 1200);
    await rec.tap(page, 'table', card(page, 'Masa 05'), { hold: 1600 });
    await rec.tap(page, 'add', page.getByRole('dialog').getByRole('button', { name: /Sipariş ekle/ }), { hold: 1400 });
    rec.mark('composer');
    await pause(page, 1200);
    await scrollTo(page, await pageY(page, '.menu-tools'), 110, 1100);
    rec.mark('products');
    await rec.tap(page, 'cat', page.locator('.category-tabs').getByRole('button', { name: 'Kahveler' }), { hold: 1100 });
    await rec.tap(page, 'p0', page.locator('.staff-card', { hasText: 'Türk Kahvesi' }).first(), { hold: 1200 });
    const dlg = page.getByRole('dialog');
    await rec.tap(page, 'sugar', dlg.getByText(/^Orta$/).first(), { hold: 700 });
    await rec.tap(page, 'more', dlg.getByRole('button', { name: 'Adedi artır' }), { hold: 700 });
    await typeIn(page, rec, 'note', dlg.getByPlaceholder(/Örn\./), 'Biri az köpüklü', { delay: 70 });
    await pause(page, 600);
    await rec.tap(page, 'add0', dlg.getByRole('button', { name: /Sepete ekle/ }), { hold: 1000 });
    await rec.tap(page, 'all', page.locator('.category-tabs').getByRole('button', { name: 'Tümü' }), { hold: 800 });
    await typeIn(page, rec, 'search', page.getByRole('textbox', { name: 'Ürün ara' }), 'san', { delay: 140 });
    await pause(page, 900);
    await rec.tap(page, 'p1', page.locator('.staff-card', { hasText: 'San Sebastian' }).first(), { hold: 1200 });
    await rec.tap(page, 'add1', dlg.getByRole('button', { name: /Sepete ekle/ }), { hold: 1100 });
    await rec.tap(page, 'cart', page.locator('.staff-basket-open'), { hold: 1600 });
    rec.mark('cartOpen');
    await pause(page, 1200);
    await rec.tap(page, 'send', dlg.getByRole('button', { name: 'Siparişi gönder', exact: true }), { hold: 200 });
    await page.getByText(/mutfağa gönderildi/).first().waitFor({ timeout: 15000 });
    rec.mark('sent');
    await kitchen.page.locator('.kitchen-card', { hasText: 'Masa 05' }).first().waitFor({ timeout: 20000 });
    recK.mark('ticket');
    await recK.box('ticket', kitchen.page.locator('.kitchen-card', { hasText: 'Masa 05' }).first());
    await pause(page, 3600);
    await recK.stop(); await rec.stop();
    await kitchen.ctx.close();
    await forgetBasket(page);
    info.order = (await ordersOf(desk, 'Masa 05')).map(o => o.number);

    // ===== g4: a QR order waiting for the waiter's approval =====
    console.log('Kayıt: g4-onay');
    await toMasalar(page);
    rec = new Recorder(page, join(OUT, 'g4-onay'), TABLET);
    await rec.start(); await pause(page, 1500);
    rec.mark('wait0');
    await guestOrder(desk, 'Masa 14');
    const approve = page.getByRole('button', { name: 'Onayla ve mutfağa gönder' }).first();
    await approve.waitFor({ timeout: 20000 });
    rec.mark('arrived'); await pause(page, 800);
    await rec.look(page, 'queue', page.locator('.approval-queue').first(), 3600);
    await rec.look(page, 'reject', page.getByRole('button', { name: 'Reddet' }).first(), 2600);
    await rec.tap(page, 'approve', approve, { hold: 300 });
    await page.locator('.approval-queue').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    rec.mark('approved'); await pause(page, 2000);
    await rec.stop();

    // ===== g5: a waiter call =====
    console.log('Kayıt: g5-cagri');
    await page.evaluate('scrollTo(0, 0)'); await pause(page, 500);
    rec = new Recorder(page, join(OUT, 'g5-cagri'), TABLET);
    await rec.start(); await pause(page, 1200);
    rec.mark('wait0');
    await guestCall(desk, 'Masa 05');
    await page.locator('.service-call-chip').first().waitFor({ timeout: 15000 });
    rec.mark('chip'); await pause(page, 800);
    await rec.look(page, 'chip', page.locator('.service-call-chip').first(), 3000);
    await rec.tap(page, 'close', page.getByRole('button', { name: 'Masa 05 çağrısını kapat' }), { lead: 2000, hold: 300 });
    await page.locator('.service-call-chip').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    rec.mark('closed'); await pause(page, 1800);
    await rec.stop();

    // ===== g6: ready → served =====
    console.log('Kayıt: g6-hazir');
    await advance(desk, 'Masa 07', ['served']);  // the demo's ready order elsewhere is taken first: only Masa 05's is on the list
    await pause(page, 5000);
    rec = new Recorder(page, join(OUT, 'g6-hazir'), TABLET);
    await rec.start(); await pause(page, 1200);
    rec.mark('wait0');
    await advance(desk, 'Masa 05', ['preparing', 'ready']);
    await page.locator('.nav-count').first().waitFor({ timeout: 20000 });
    rec.mark('ready'); await pause(page, 2600);
    await rec.tap(page, 'nav', nav(page, 'Servise hazır'), { lead: 2200, hold: 1400 });
    rec.mark('list');
    const readyCard = page.locator('.ready-orders article', { hasText: 'Masa 05' }).first();
    await rec.look(page, 'card', readyCard, 3200);
    await rec.tap(page, 'served', readyCard.getByRole('button', { name: 'Teslim edildi' }), { hold: 300 });
    await page.getByText('Sipariş teslim edildi.').first().waitFor({ timeout: 15000 }).catch(() => {});
    rec.mark('served'); await pause(page, 2200);
    await rec.stop();

    // ===== g7: more for an open table =====
    console.log('Kayıt: g7-ekle');
    await toMasalar(page);
    await toGrid(page);
    rec = new Recorder(page, join(OUT, 'g7-ekle'), TABLET);
    await rec.start(); await pause(page, 1200);
    await rec.tap(page, 'table', card(page, 'Masa 05'), { hold: 1400 });
    await rec.look(page, 'bill', page.getByRole('dialog').locator('.detail-order').first(), 2600);
    await rec.tap(page, 'add', page.getByRole('dialog').getByRole('button', { name: /Sipariş ekle/ }), { hold: 1200 });
    await scrollTo(page, await pageY(page, '.menu-tools'), 110, 1100);
    rec.mark('products');
    await rec.tap(page, 'cat', page.locator('.category-tabs').getByRole('button', { name: 'Çaylar' }), { hold: 1000 });
    const plus = page.getByRole('button', { name: /^Demleme Çay · bir adet ekle/ });
    await rec.tap(page, 'p0', plus, { hold: 900 });
    await rec.tap(page, 'p0b', page.getByRole('button', { name: /^Demleme Çay · bir adet (daha )?ekle/ }), { hold: 1400 });
    await rec.tap(page, 'send', page.locator('.staff-basket-send'), { hold: 200 });
    await page.getByText(/mutfağa gönderildi/).first().waitFor({ timeout: 15000 });
    rec.mark('sent'); await pause(page, 2800);
    await rec.stop();
    await forgetBasket(page);
    // Off camera: the tea goes through the kitchen and to the table.
    await advance(desk, 'Masa 05', ['preparing', 'ready', 'served']);
    await pause(page, 6000);

    // ===== g8: move the bill to another table =====
    console.log('Kayıt: g8-tasi');
    await toMasalar(page);
    await toGrid(page);
    rec = new Recorder(page, join(OUT, 'g8-tasi'), TABLET);
    await rec.start(); await pause(page, 1200);
    await rec.tap(page, 'table', card(page, 'Masa 05'), { hold: 1400 });
    await rec.tap(page, 'move', page.getByRole('dialog').getByRole('button', { name: 'Taşı / birleştir' }), { hold: 1600 });
    const target = page.getByRole('dialog').getByLabel('Hedef masa');
    await rec.look(page, 'note', page.getByRole('dialog').locator('p').first(), 2400);
    // The native list of the select is not in the picture: a tap on the field, then the choice.
    { const box = await target.boundingBox(); const t = Date.now() / 1000; rec.taps.push({ name: 'select', box: box!, on: t - .2, tap: t }); }
    await target.focus(); await pause(page, 500);
    await target.selectOption({ label: 'Masa 08' });
    rec.mark('chosen'); await pause(page, 2400);
    await rec.tap(page, 'confirm', page.getByRole('dialog').getByRole('button', { name: /Hesabı taşı/ }), { hold: 300 });
    await page.getByText(/Hesap taşındı/).first().waitFor({ timeout: 15000 });
    rec.mark('moved'); await pause(page, 1600);
    await rec.look(page, 'target', card(page, 'Masa 08'), 2600);
    await rec.stop();
    info.afterMove = await tableStates(desk);

    // ===== g9: the bill and the cleaning =====
    console.log('Kayıt: g9-hesap');
    await page.evaluate('scrollTo(0, 0)'); await pause(page, 5000);
    rec = new Recorder(page, join(OUT, 'g9-hesap'), TABLET);
    await rec.start(); await pause(page, 1200);
    rec.mark('wait0');
    await guestCall(desk, 'Masa 08', true);
    await page.locator('.service-call-chip').first().waitFor({ timeout: 15000 });
    rec.mark('chip'); await pause(page, 800);
    await rec.look(page, 'chip', page.locator('.service-call-chip').first(), 3600);
    await rec.tap(page, 'close', page.getByRole('button', { name: 'Masa 08 çağrısını kapat' }), { lead: 1200, hold: 300 });
    await page.locator('.service-call-chip').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    rec.mark('closed'); await pause(page, 1500);
    rec.mark('pay0');
    await cashierPays(desk, 'Masa 08');
    await card(page, 'Masa 08').locator('.table-status', { hasText: 'Temizlik bekliyor' }).waitFor({ timeout: 20000 });
    rec.mark('paid'); await pause(page, 300);
    await toGrid(page);
    rec.mark('cleaning');
    await rec.look(page, 'card', card(page, 'Masa 08'), 2800);
    await rec.tap(page, 'table', card(page, 'Masa 08'), { hold: 1400 });
    await rec.tap(page, 'cleaned', page.getByRole('dialog').getByRole('button', { name: /Temizlendi/ }), { hold: 300 });
    await page.getByText('Masa siparişe hazır.').first().waitFor({ timeout: 15000 }).catch(() => {});
    rec.mark('clean'); await pause(page, 1200);
    await rec.look(page, 'free', card(page, 'Masa 08'), 2600);
    await rec.stop();
    info.after = await tableStates(desk);
    await tctx.close();
  } finally {
    writeFileSync(join(OUT, 'bilgi.json'), JSON.stringify(info, null, 1));
    await k.close();
  }
}
await main();
