/*
 * YouTube E2 "Kasiyer eğitimi" (training series, the cashier's own screen): recordings of the REAL app on the café computer's
 * counter window (edit: scripts/sosyal/youtube-kasiyer-kurgu.ts). One run in story order on a fresh Mola Merkez + demo café
 * ("Mola Örnek Kafe", shared parts: scripts/sosyal/kayit-ortak.ts) in .local/sosyal/youtube/kasiyer/run-<zaman>/.
 *
 * The run plays on the recording clock (kit({ saat })): the demo is made "yesterday evening", whose floor is settled and whose
 * kasa Zeynep Arslan (the demo's cashier) closes with ₺500 left in the drawer, all off camera. Then the clock goes to this
 * morning: the opening says "Dünden devreden: ₺500". The morning's orders are entered by the waiter off camera (Masa 03, 06,
 * 09 and a few more), the day's work is recorded, and the clock goes to 22:35 for the gün sonu.
 *
 *   k1-giris    sign-in page: kullanıcı adı, şifre, "Çalışma alanını aç" → Masalar with "Kasa açılışı"; "Ses kapalı".
 *   k2-acilis   "Dünden devreden: ₺500" → "Açılışı onayla · ₺500" → the chip "Kasa açık · 07:57'den beri · ₺500".
 *   k3-nakit    Masa 03 → "Ödeme al" → Nakit, "₺500" → para üstü ₺120 → "Ödemeyi kaydet" → "Verilecek para üstü".
 *   k4-kart     the Masa 06 guest asks for the bill, "Kart" (guest phone off camera) → "Hesap · Kart" → the table → "Ödeme
 *               al" opens on Kart → "Ödemeyi kaydet".
 *   k5-bolme    Masa 09 (three friends) → "Ödeme al" → "Ürün seç" (Americano + Künefe, Kart) → "Bir kısmı" ₺380 Nakit →
 *               the rest by Kart.
 *   k6-masasiz  "Sipariş al" → "Masasız sipariş" → name "Elif", Limonata + Brownie → "Gönder" → the payment opens → Kart;
 *               the kitchen makes it (off camera) → the strip's "Teslim edildi".
 *   k7-iade     the cash chip → "İade" → today's payments → Masa 03 → one Türk Kahvesi, "Beğenilmedi", note → Nakit.
 *   k8-gider    the cash chip → "Gider kaydet" → ₺180, "Acil süt alımı", Kasadan.
 *   k9-gunsonu  22:35, every bill closed (off camera): "Bütün hesaplar kapandı" → "Gün sonunu yap" → the count by notes and
 *               coins, the bank POS total → "Sayımı kaydet" → ₺500 left → "Kapanışı tamamla" → "Tamam".
 *
 *   npx tsx scripts/sosyal/youtube-kasiyer-kayit.ts            (needs `npm run build`; ~8 minutes)
 *
 * No pointer: every click goes through Recorder.tap (box saved, a still lead-in the edit cuts). Counter window 1280×800 (2×).
 * Ports: café 3742, Mola Merkez 3798. Every process is stopped at the end.
 * Output: .local/sosyal/youtube/kasiyer/kayit/<klip>/ (meta.json) and kayit/bilgi.json (amounts, times).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { DESKTOP, NO_HINTS, PASSWORD, ROOT, Recorder, kit, pause, typeIn, type Product, type StaffState } from './kayit-ortak';

const BASE = join(ROOT, '.local', 'sosyal', 'youtube', 'kasiyer');
const OUT = join(BASE, 'kayit');
const run = join(BASE, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
/** A time of the Istanbul day `day` days from today's (real) date, as ms. */
function istanbul(day: number, hh: number, mm: number) {
  const d = new Date(Date.now() + 3 * 3600e3), start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + day * 86400e3;
  return start + (hh - 3) * 3600e3 + mm * 60e3;
}
const k = kit({ run, kafePort: 3742, merkezPort: 3798, saat: istanbul(-1, 22, 10) });
mkdirSync(OUT, { recursive: true });
const info: Record<string, unknown> = {};

// ---------- Off-camera helpers ----------
type Account = { id: string; version: number; balance: number; total: number; paid: number };
type Tbl = { id: string; name: string; epoch: number; token: string; needsCleaning?: boolean; account: Account | null };
type Group = { id: string; required: boolean; options: { id: string; extra: number }[] };
type State = Omit<StaffState, 'tables' | 'orders' | 'products'> & { tables: Tbl[]; paymentContext: string; takeaways?: Tbl[]; products: (Omit<Product, 'groups'> & { groups: Group[] })[];
  orders: (StaffState['orders'][number] & { tableName?: string })[] };
/** A signed-in request context of one of the demo's accounts (isletme, kasiyer, garson). */
async function as(user: string) {
  const ctx = await k.deskBrowser.newContext(), page = await ctx.newPage();
  await k.login(page, user);
  return { req: page.request, close: () => ctx.close() };
}
const stateOf = async (req: APIRequestContext) => (await (await req.get(`${k.KAFE}/api/staff/state`)).json()) as State;
/** A waiter's order (the first option of each required choice), as the waiter's tablet sends it. */
async function order(table: string, lines: [string, number][]) {
  const w = await as('garson'), s = await stateOf(w.req), t = s.tables.find(x => x.name === table)!;
  const cart = lines.map(([name, quantity]) => {
    const p = s.products.find(x => x.name === name);
    if (!p) throw new Error(`Ürün yok: ${name}`);
    const selections = p.groups.filter(g => g.required).map(g => ({ groupId: g.id, optionId: g.options[0].id }));
    const unit = p.price + p.groups.filter(g => g.required).reduce((n, g) => n + g.options[0].extra, 0);
    return { line: { productId: p.id, quantity, selections }, total: unit * quantity };
  });
  await k.post(w.req, '/api/staff/orders', { requestId: randomUUID(), tableId: t.id, lines: cart.map(c => c.line), expectedTotal: cart.reduce((n, c) => n + c.total, 0) });
  await w.close();
}
/** The kitchen's steps through the owner's API (the kitchen screen is never on camera). `table`: undefined = every order. */
async function advance(to: ('preparing' | 'ready' | 'served')[], table?: string) {
  const api = await k.ownerApi(k.deskBrowser);
  for (const step of to) {
    const s = await stateOf(api.req);
    for (const o of s.orders.filter(o => (!table || o.tableName === table) && !['served', 'cancelled', 'rejected', 'awaiting_approval'].includes(o.status) && o.status !== step))
      await k.post(api.req, '/api/staff/status', { requestId: randomUUID(), orderId: o.id, version: o.version, status: step }).catch(() => {});
  }
  await api.close();
}
/** The cashier takes a whole bill (off camera). */
async function pays(table: string, method: 'cash' | 'card') {
  const c = await as('kasiyer'), s = await stateOf(c.req), a = [...s.tables, ...(s.takeaways ?? [])].find(t => t.name === table)!.account!;
  await k.post(c.req, '/api/staff/payments', { requestId: randomUUID(), paymentContext: s.paymentContext, accountId: a.id, version: a.version, method, amount: a.balance, tendered: method === 'cash' ? Math.ceil(a.balance / 10000) * 10000 : a.balance });
  await c.close();
}
/** Every open bill paid (cash and card by turns), every order served, empty bills closed, every table cleaned. */
async function settleAll() {
  await advance(['preparing', 'ready', 'served']);
  const api = await k.ownerApi(k.deskBrowser);
  let s = await stateOf(api.req), n = 0;
  for (const t of [...s.tables, ...(s.takeaways ?? [])]) if (t.account && t.account.balance > 0) await pays(t.name, n++ % 3 === 1 ? 'cash' : 'card');
  s = await stateOf(api.req);
  for (const t of [...s.tables, ...(s.takeaways ?? [])]) if (t.account && !t.account.balance) await k.post(api.req, '/api/staff/close-empty', { requestId: randomUUID(), accountId: t.account.id }).catch(() => {});
  await api.close();
  await cleanAll();
}
async function cleanAll() {
  const w = await as('garson'), s = await stateOf(w.req);
  for (const t of s.tables.filter(t => t.needsCleaning)) await k.post(w.req, '/api/staff/tables/clean', { requestId: randomUUID(), tableId: t.id, epoch: t.epoch });
  await w.close();
}
/** The guest at `table` asks for the bill and says "Kart" (a phone never on camera). */
async function guestBill(table: string) {
  const api = await k.ownerApi(k.deskBrowser), token = (await stateOf(api.req)).tables.find(t => t.name === table)!.token; await api.close();
  const ctx = await k.phoneContext(), page = await ctx.newPage();
  await k.openMenu(page, token);
  await page.evaluate('scrollTo(0, 0)'); await pause(page, 400);
  await page.getByRole('button', { name: 'Hesabı iste' }).click(); await pause(page, 500);
  await page.getByRole('group', { name: 'Nasıl ödeyeceksiniz?' }).getByRole('button', { name: 'Kart' }).click();
  await page.getByRole('button', { name: 'Hesap istendi' }).waitFor();
  await ctx.close();
}
/** Today's payments as the counter lists them (for the POS total of the gün sonu). */
async function todaysPayments() {
  const c = await as('kasiyer');
  const r = await (await c.req.get(`${k.KAFE}/api/staff/refunds/payments`)).json() as { rows: { tableName: string; amount: number; method: string; refunded: number }[] };
  await c.close();
  return r.rows;
}
const ist = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

// ---------- On the counter window ----------
const card = (page: Page, table: string) => page.locator('.table-card', { has: page.locator('h3', { hasText: new RegExp(`^${table}$`) }) }).first();
const dialog = (page: Page) => page.getByRole('dialog').last();
const chip = (page: Page) => page.locator('.cash-chip').first();
const toast = (page: Page, text: RegExp) => page.getByText(text).first().waitFor({ timeout: 15000 });
async function top(page: Page) { await page.evaluate('scrollTo({ top: 0, behavior: "smooth" })'); await pause(page, 900); }
/** The table grid's section in sight (the heading of `area` near the top). */
async function toArea(page: Page, heading: string) {
  const y = await page.getByRole('heading', { name: heading }).first().evaluate(e => e.getBoundingClientRect().top + scrollY);
  await page.evaluate(`scrollTo({ top: ${Math.max(0, y - 24)}, behavior: "smooth" })`); await pause(page, 1100);
}
/** The cash chip's menu ("Kasa açık · …"), then one of its actions. `lead`: a longer still moment where the edit shows the chip. */
async function chipAction(page: Page, rec: Recorder, action: RegExp, lead = 1200) {
  await rec.tap(page, 'chip', chip(page), { lead, hold: 900 });
  await rec.tap(page, 'action', page.locator('.cash-menu').getByRole('button', { name: action }), { hold: 1300 });
}
/** One of a product in the open order window: "+" for a product without choices, else its card and "Sepete ekle". */
async function addProduct(page: Page, rec: Recorder, name: string, product: string) {
  const quick = dialog(page).getByRole('button', { name: new RegExp(`^${product} · bir adet ekle`) });
  if (await quick.count()) { await rec.tap(page, name, quick, { hold: 1000 }); return; }
  console.log(`  ${product}: seçenekli`);
  await rec.tap(page, name, dialog(page).getByRole('button', { name: new RegExp(`^${product} · seçenekleri aç`) }), { hold: 1200 });
  await rec.tap(page, `${name}add`, dialog(page).getByRole('button', { name: /Sepete ekle/ }), { hold: 1000 });
}
/** Replaces a field's text the way a person does: click, select all, type. */
async function retype(page: Page, rec: Recorder, name: string, field: ReturnType<Page['locator']>, text: string) {
  await rec.tap(page, name, field, { lead: 700, hold: 150 });
  await field.press('Control+a'); await field.pressSequentially(text, { delay: 110 }); await pause(page, 400);
}

async function main() {
  await k.launch();
  const desk: Browser = k.deskBrowser;
  try {
    await k.startServers();
    await k.prepareMenu(desk, { waiterApproval: false, changeSeconds: 0 });
    await k.calm(desk, true);

    // ===== Yesterday evening (off camera): the floor settled, the kasa closed with ₺500 left =====
    await settleAll();
    { const c = await as('kasiyer');
      const counted = await k.post(c.req, '/api/staff/cash/count', { requestId: randomUUID(), mode: 'final', counted: 50000, pos: null }) as { id: string };
      await k.post(c.req, '/api/staff/cash/finish', { id: counted.id, left: 50000 });
      await c.close(); }
    console.log('Dün kapandı:', ist(k.now()));

    // ===== This morning =====
    await k.setClock(istanbul(0, 7, 55));
    const ctx = await k.desktopContext(); await ctx.addInitScript(NO_HINTS);
    const page = await ctx.newPage();
    // Signed in once (and out) off camera, so the recorded sign-in is the everyday one.
    await k.login(page, 'kasiyer');
    await page.getByRole('button', { name: 'Çıkış yap' }).first().click();
    await page.getByLabel('Kullanıcı adı', { exact: true }).waitFor().catch(async e => { await page.screenshot({ path: join(BASE, 'hata.png') }); throw e; });
    await page.goto(`${k.KAFE}/`);
    await page.getByLabel('Kullanıcı adı', { exact: true }).waitFor(); await pause(page, 1200);
    info.morning = ist(k.now());

    // ===== k1: sign in =====
    console.log('Kayıt: k1-giris');
    let rec = new Recorder(page, join(OUT, 'k1-giris'), DESKTOP);
    await rec.start(); await pause(page, 1800);
    await typeIn(page, rec, 'user', page.getByLabel('Kullanıcı adı', { exact: true }), 'kasiyer', { delay: 90 });
    await typeIn(page, rec, 'pass', page.getByLabel('Şifre', { exact: true }), PASSWORD, { delay: 60 });
    await rec.tap(page, 'open', page.getByRole('button', { name: 'Çalışma alanını aç' }), { hold: 300 });
    await page.locator('.cash-opening').first().waitFor({ timeout: 20000 });
    rec.mark('in'); await pause(page, 2400);
    const sound = page.getByText(/Ses kapalı/).first();
    if (await sound.isVisible().catch(() => false)) { await rec.tap(page, 'sound', sound, { lead: 1400, hold: 1400 }); rec.mark('soundOn'); }
    await pause(page, 1000);
    await rec.stop();

    // ===== k2: the opening =====
    console.log('Kayıt: k2-acilis');
    rec = new Recorder(page, join(OUT, 'k2-acilis'), DESKTOP);
    await rec.start(); await pause(page, 1200);
    await rec.look(page, 'card', page.locator('.cash-opening').first(), 3800);
    await rec.look(page, 'other', page.getByRole('button', { name: 'Farklı tutar bildir' }), 2600);
    await rec.tap(page, 'confirm', page.getByRole('button', { name: /^Açılışı onayla/ }), { hold: 300 });
    await toast(page, /Kasa açıldı/);
    rec.mark('open'); await pause(page, 1200);
    await rec.look(page, 'chip', chip(page), 3200);
    await rec.stop();
    info.opening = ist(k.now());

    // ===== Off camera: the morning's orders =====
    await k.setClock(istanbul(0, 8, 25));
    await order('Masa 05', [['Ayran', 2], ['Fırın Sütlaç', 1]]);
    await order('Masa 03', [['Türk Kahvesi', 2], ['San Sebastian', 1]]);
    await order('Masa 06', [['Caffè Latte', 2], ['Çikolatalı Brownie', 2]]);
    await order('Masa 09', [['Americano', 1], ['Künefe', 1], ['Caffè Latte', 1], ['Fıstıklı Baklava', 1], ['Ev Yapımı Limonata', 1], ['Profiterol', 1]]);
    await order('Masa 12', [['Americano', 1], ['San Sebastian', 1]]);
    await order('Masa 14', [['Caffè Latte', 1], ['Kazandibi', 1]]);
    await advance(['preparing', 'ready', 'served']);
    await pays('Masa 05', 'card');
    await k.setClock(istanbul(0, 9, 2));
    await order('Masa 10', [['Ihlamur', 1], ['Fırın Sütlaç', 1]]);
    await advance(['preparing'], 'Masa 10');
    await order('Masa 01', [['Demleme Çay', 2]]);
    await pause(page, 4000);
    await top(page);
    const c0 = await as('kasiyer'), s0 = await stateOf(c0.req); await c0.close();
    info.bills = Object.fromEntries(s0.tables.filter(t => t.account).map(t => [t.name, t.account!.balance]));
    console.log('Hesaplar:', JSON.stringify(info.bills));

    // ===== k3: a cash payment =====
    console.log('Kayıt: k3-nakit');
    rec = new Recorder(page, join(OUT, 'k3-nakit'), DESKTOP);
    await rec.start(); await pause(page, 1200);
    await rec.tap(page, 'table', card(page, 'Masa 03'), { hold: 1400 });
    await rec.look(page, 'bill', dialog(page).locator('.table-detail-summary').first(), 2600);
    await rec.tap(page, 'pay', dialog(page).getByRole('button', { name: 'Ödeme al' }), { hold: 1400 });
    rec.mark('modal');
    await rec.look(page, 'method', dialog(page).locator('.payment-method'), 2200);
    await rec.tap(page, 'note', dialog(page).locator('.payment-quick').getByRole('button', { name: '₺500' }), { hold: 1200 });
    await rec.look(page, 'change', dialog(page).locator('.payment-change'), 2400);
    await rec.tap(page, 'save', dialog(page).getByRole('button', { name: /Ödemeyi kaydet/ }), { hold: 200 });
    await page.locator('[data-testid="change-due"]').waitFor({ timeout: 15000 });
    rec.mark('paid'); await pause(page, 900);
    await rec.look(page, 'due', page.locator('[data-testid="change-due"]'), 3000);
    await rec.look(page, 'cleaning', card(page, 'Masa 03'), 2400);
    await rec.stop();

    // ===== k4: the guest asks for the bill, card =====
    console.log('Kayıt: k4-kart');
    await top(page); await pause(page, 2500);
    rec = new Recorder(page, join(OUT, 'k4-kart'), DESKTOP);
    await rec.start(); await pause(page, 1200);
    rec.mark('wait0');
    await guestBill('Masa 06');
    await page.locator('.service-call-chip').first().waitFor({ timeout: 20000 });
    rec.mark('chip'); await pause(page, 900);
    await rec.look(page, 'call', page.locator('.service-call-chip').first(), 3200);
    await rec.tap(page, 'open', page.locator('.service-call-chip').first().locator('.service-call-open'), { hold: 1400 });
    await rec.look(page, 'said', dialog(page).locator('.bill-method-note'), 2600);
    await rec.tap(page, 'pay', dialog(page).getByRole('button', { name: 'Ödeme al' }), { hold: 1400 });
    rec.mark('modal');
    await rec.look(page, 'card', dialog(page).locator('.payment-method'), 2400);
    await rec.look(page, 'pos', dialog(page).locator('.payment-card-note'), 3000);
    await rec.tap(page, 'save', dialog(page).getByRole('button', { name: /Ödemeyi kaydet/ }), { hold: 200 });
    await toast(page, /Hesap kapandı|Ödeme tamamlandı/);
    rec.mark('paid'); await pause(page, 2600);
    await rec.stop();

    // ===== k5: splitting the bill =====
    console.log('Kayıt: k5-bolme');
    await toArea(page, 'Bahçe masaları'); await pause(page, 800);
    rec = new Recorder(page, join(OUT, 'k5-bolme'), DESKTOP);
    await rec.start(); await pause(page, 1200);
    await rec.tap(page, 'table', card(page, 'Masa 09'), { hold: 1200 });
    await rec.tap(page, 'pay', dialog(page).getByRole('button', { name: 'Ödeme al' }), { hold: 1300 });
    rec.mark('modal');
    const pd = () => dialog(page);
    await rec.tap(page, 'items', pd().locator('.payment-scope').getByRole('button', { name: 'Ürün seç' }), { lead: 1800, hold: 1200 });
    await pd().locator('.payment-items .payment-stepper').first().waitFor({ timeout: 10000 });
    await rec.tap(page, 'i0', pd().getByRole('button', { name: /^Americano.* bir adet ekle$/ }), { hold: 700 });
    await rec.tap(page, 'i1', pd().getByRole('button', { name: /^Künefe bir adet ekle$/ }), { hold: 900 });
    await rec.look(page, 'sum', pd().getByText(/Seçtiğiniz ürünlerin toplamı/), 2000);
    await rec.tap(page, 'card1', pd().locator('.payment-method').getByRole('button', { name: 'Kart' }), { hold: 900 });
    await rec.tap(page, 'save1', pd().getByRole('button', { name: /Ödemeyi kaydet/ }), { hold: 200 });
    await pd().getByText(/Ödeme kaydedildi\. Kalan/).first().waitFor({ timeout: 15000 });
    rec.mark('paid1');
    const first = await pd().getByText(/Ödeme kaydedildi\. Kalan/).first().innerText();
    await pause(page, 2600);
    await rec.tap(page, 'part', pd().locator('.payment-scope').getByRole('button', { name: 'Bir kısmı' }), { hold: 900 });
    await retype(page, rec, 'amount', pd().getByLabel('Tahsil edilecek tutar (TL)'), '380');
    await rec.tap(page, 'cash2', pd().locator('.payment-method').getByRole('button', { name: 'Nakit' }), { hold: 1200 });
    await rec.tap(page, 'save2', pd().getByRole('button', { name: /Ödemeyi kaydet/ }), { hold: 200 });
    await page.waitForFunction(t => [...document.querySelectorAll('dialog *, [role=dialog] *')].some(e => e.childElementCount === 0 && /Ödeme kaydedildi\. Kalan/.test(e.textContent ?? '') && !(e.textContent ?? '').includes(t.replace(/^.*Kalan: /, 'Kalan: '))), first, { timeout: 15000 });
    rec.mark('paid2'); await pause(page, 2400);
    await rec.tap(page, 'card3', pd().locator('.payment-method').getByRole('button', { name: 'Kart' }), { hold: 1000 });
    await rec.tap(page, 'save3', pd().getByRole('button', { name: /Ödemeyi kaydet/ }), { hold: 200 });
    await toast(page, /Hesap kapandı|Ödeme tamamlandı/);
    rec.mark('paid3'); await pause(page, 2400);
    await rec.stop();

    // ===== k6: a sale without a table =====
    console.log('Kayıt: k6-masasiz');
    await top(page);
    rec = new Recorder(page, join(OUT, 'k6-masasiz'), DESKTOP);
    await rec.start(); await pause(page, 1200);
    await rec.tap(page, 'new', page.locator('.floor-head-actions').getByRole('button', { name: /Sipariş al/ }), { hold: 1400 });
    await rec.tap(page, 'choice', page.locator('.no-table-choice'), { hold: 1400 });
    rec.mark('form');
    await typeIn(page, rec, 'name', dialog(page).getByRole('textbox', { name: 'Müşteri adı', exact: true }), 'Elif', { delay: 110 });
    await pause(page, 500);
    await addProduct(page, rec, 'p0', 'Ev Yapımı Limonata');
    await addProduct(page, rec, 'p1', 'Çikolatalı Brownie');
    await rec.tap(page, 'send', dialog(page).locator('.staff-basket-send'), { hold: 200 });
    await page.getByRole('dialog').filter({ hasText: 'Ödeme al' }).first().waitFor({ timeout: 15000 });
    rec.mark('payment'); await pause(page, 1600);
    await rec.look(page, 'later', dialog(page).getByRole('button', { name: 'Sonra öde' }), 2200);
    await rec.tap(page, 'card', dialog(page).locator('.payment-method').getByRole('button', { name: 'Kart' }), { hold: 1000 });
    await rec.tap(page, 'save', dialog(page).getByRole('button', { name: /Ödemeyi kaydet/ }), { hold: 200 });
    await toast(page, /Hesap kapandı|Ödeme tamamlandı/);
    rec.mark('paid'); await pause(page, 1200);
    await rec.tap(page, 'nav', page.locator('aside nav').getByRole('button', { name: /^Masalar/ }), { hold: 1200 });
    const strip = page.locator('.takeaway-strip');
    await strip.waitFor({ timeout: 10000 });
    rec.mark('strip');
    await rec.look(page, 'strip', strip, 3000);
    rec.mark('wait0');
    await advance(['preparing', 'ready']);
    const serve = strip.getByRole('button', { name: /Teslim edildi/ }).first();
    await serve.waitFor({ timeout: 20000 });
    rec.mark('ready'); await pause(page, 1000);
    await rec.look(page, 'readyCard', strip.locator('.takeaway-card').first(), 2400);
    await rec.tap(page, 'served', serve, { hold: 300 });
    await strip.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    rec.mark('done'); await pause(page, 1800);
    await rec.stop();

    // ===== k7: a refund =====
    console.log('Kayıt: k7-iade');
    await top(page); await pause(page, 600);
    rec = new Recorder(page, join(OUT, 'k7-iade'), DESKTOP);
    await rec.start(); await pause(page, 1200);
    await chipAction(page, rec, /^İade$/, 2200);
    rec.mark('window');
    await dialog(page).locator('.refund-payments').waitFor({ timeout: 10000 });
    await rec.look(page, 'limits', dialog(page).locator('.refund-limits'), 3200);
    await rec.tap(page, 'row', dialog(page).locator('.refund-payments button', { hasText: 'Masa 03' }).first(), { hold: 1400 });
    await dialog(page).locator('.refund-items').waitFor({ timeout: 10000 });
    rec.mark('form');
    await rec.tap(page, 'item', dialog(page).getByRole('button', { name: /^Türk Kahvesi bir adet ekle$/ }), { lead: 1800, hold: 1000 });
    await rec.tap(page, 'reason', dialog(page).locator('.refund-chips').getByRole('button', { name: 'Beğenilmedi' }), { hold: 600 });
    await typeIn(page, rec, 'note', dialog(page).getByPlaceholder('Örn. Kahve soğuk geldi'), 'Kahve soğuk geldi', { delay: 70 });
    await pause(page, 600);
    await rec.look(page, 'method', dialog(page).locator('.refund-method'), 2600);
    await rec.tap(page, 'save', dialog(page).getByRole('button', { name: 'İadeyi kaydet' }), { hold: 1400 });
    await rec.look(page, 'confirm', dialog(page).locator('.refund-confirm'), 2400);
    await rec.tap(page, 'yes', dialog(page).getByRole('button', { name: 'Evet, iadeyi kaydet' }), { hold: 200 });
    await toast(page, /iade kaydedildi/);
    rec.mark('done'); await pause(page, 2600);
    await rec.stop();

    // ===== k8: an expense =====
    console.log('Kayıt: k8-gider');
    await pause(page, 2000);
    rec = new Recorder(page, join(OUT, 'k8-gider'), DESKTOP);
    await rec.start(); await pause(page, 1200);
    await chipAction(page, rec, /^Gider kaydet$/);
    rec.mark('form');
    await typeIn(page, rec, 'amount', dialog(page).getByRole('textbox', { name: 'Gider tutarı', exact: true }), '180', { delay: 140 });
    await typeIn(page, rec, 'text', dialog(page).getByRole('textbox', { name: 'Gider açıklaması', exact: true }), 'Acil süt alımı', { delay: 70 });
    await pause(page, 500);
    await rec.tap(page, 'drawer', dialog(page).getByRole('radio', { name: /Kasadan/ }), { hold: 1600 });
    await rec.tap(page, 'save', dialog(page).getByRole('button', { name: 'Gideri kaydet' }), { hold: 200 });
    await toast(page, /Gider kaydedildi/);
    rec.mark('done'); await pause(page, 2400);
    await rec.stop();

    // ===== Off camera: the rest of the day, every bill closed at night =====
    await k.setClock(istanbul(0, 22, 31));
    await settleAll();
    { const api = await k.ownerApi(desk); await k.post(api.req, '/api/staff/cash/settings', { closingTime: '22:30' }); await api.close(); }
    const rows = await todaysPayments();
    const posTotal = rows.filter(r => r.method === 'card').reduce((n, r) => n + r.amount - r.refunded, 0);
    const exp = await (async () => { const api = await k.ownerApi(desk), r = await (await api.req.get(`${k.KAFE}/api/staff/cash/expected`)).json() as { expected: number }; await api.close(); return r.expected; })();
    info.payments = rows; info.posTotal = posTotal; info.expectedCash = exp;
    console.log(`Gün: ${rows.length} ödeme, POS ${posTotal / 100} TL, beklenen nakit ${exp / 100} TL`);
    // What the drawer holds, as notes and coins (the count matches the expected cash: no difference).
    const notes: [number, number][] = []; { let left = exp; for (const v of [20000, 10000, 5000, 2000, 1000, 500, 100]) { const n = Math.floor(left / v); if (n) { notes.push([v, n]); left -= n * v; } } if (left) throw new Error(`Bozuk para kaldı: ${left}`); }
    info.notes = notes;
    await page.reload(); await pause(page, 2500);
    await page.mouse.click(900, 20); await pause(page, 600);
    const sound2 = page.getByText(/Ses kapalı/).first();
    if (await sound2.isVisible().catch(() => false)) { await sound2.click(); await pause(page, 600); }
    await top(page); await pause(page, 1500);
    info.evening = ist(k.now());

    // ===== k9: the gün sonu =====
    console.log('Kayıt: k9-gunsonu');
    rec = new Recorder(page, join(OUT, 'k9-gunsonu'), DESKTOP);
    await rec.start(); await pause(page, 1200);
    const remind = page.locator('.cash-alert', { hasText: 'Bütün hesaplar kapandı' }).first();
    await remind.waitFor({ timeout: 40000 });
    await rec.look(page, 'remind', remind, 3600);
    await rec.tap(page, 'open', remind.getByRole('button', { name: 'Gün sonunu yap' }), { hold: 1600 });
    rec.mark('count');
    await rec.look(page, 'lead', dialog(page).locator('.cash-lead'), 3000);
    const name = (v: number) => `${v / 100} TL adedi`;
    for (const [v, n] of notes) await typeIn(page, rec, `n${v}`, dialog(page).getByRole('textbox', { name: name(v), exact: true }), String(n), { lead: 500, delay: 160 });
    await pause(page, 600);
    await rec.look(page, 'counted', dialog(page).locator('.cash-counted'), 2200);
    await typeIn(page, rec, 'pos', dialog(page).getByRole('textbox', { name: 'Banka POS gün sonu toplamı', exact: true }), String(posTotal / 100).replace('.', ','), { delay: 120 });
    await pause(page, 900);
    await rec.tap(page, 'save', dialog(page).getByRole('button', { name: /Sayımı kaydet/ }), { hold: 1600 });
    await dialog(page).locator('[data-testid="blind-result"]').waitFor({ timeout: 15000 });
    rec.mark('result'); await pause(page, 600);
    await rec.look(page, 'blind', dialog(page).locator('[data-testid="blind-result"]'), 3000);
    await retype(page, rec, 'left', dialog(page).getByRole('textbox', { name: 'Kasada bırakılan', exact: true }), '500');
    await pause(page, 600);
    await rec.look(page, 'taken', dialog(page).getByText(/Kasadan çıkarılan/), 2600);
    await rec.tap(page, 'finish', dialog(page).getByRole('button', { name: /Kapanışı tamamla/ }), { hold: 200 });
    await dialog(page).getByRole('button', { name: 'Tamam' }).waitFor({ timeout: 15000 });
    rec.mark('done'); await pause(page, 800);
    await rec.look(page, 'doneCard', dialog(page).locator('[data-testid="blind-result"]'), 3400);
    await rec.tap(page, 'ok', dialog(page).getByRole('button', { name: 'Tamam' }), { hold: 1400 });
    rec.mark('closed');
    await rec.look(page, 'chip', chip(page), 3000);
    await rec.stop();
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
