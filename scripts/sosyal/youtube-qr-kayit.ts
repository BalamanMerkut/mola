/*
 * YouTube pilot 1 "QR menü ve QR sipariş" (sürüm 2, 18 Ekim): recordings of the REAL app for one linear story
 * (shared parts: scripts/sosyal/kayit-ortak.ts). A fresh Mola Merkez and demo café ("Mola Örnek Kafe") per run in
 * .local/sosyal/youtube/run-<zaman>/; the demo's live floor is calmed first (pending QR approvals, cancel requests and calls
 * answered, open orders served, the cash day opened), so only the clip's own orders and calls appear on the staff screens.
 *
 *   npx tsx scripts/sosyal/youtube-qr-kayit.ts                       all clips, in story order
 *   npx tsx scripts/sosyal/youtube-qr-kayit.ts b-degistir            only these
 *   npx tsx scripts/sosyal/youtube-qr-kayit.ts --sunucu              only start + prepare the servers and keep them open
 *   SOSYAL_BAGLAN=1 …                                                use servers already started by `--sunucu`
 *
 * No pointer on any screen (owner, 18 Ekim): every tap goes through Recorder.tap, which saves the control's box and holds the
 * screen still for a moment before the click; the edit zooms in there and draws a red highlight. Waiter = landscape tablet.
 * Ports: café 3721, Mola Merkez 3797. Needs `npm run build`. Output: .local/sosyal/youtube/kayit/<klip>/ (meta.json: frames,
 * marks, boxes, taps) and kayit/baski/*.png (the printed QR sheets). scripts/sosyal/youtube-kurgu.ts makes the video.
 *
 * Clips (story order; settings changed between them through the owner's API where the video does not show it)
 *   a-siparis     default settings: QR on the table, menu, "+" Türk Kahvesi (Orta), cart, send, Siparişlerim; + a-mutfak.
 *   a-ayar-sure   owner: Ayarlar → Sipariş ve mutfak → "Müşteri siparişini değiştirip iptal edebilsin" on (30 s).
 *   b-degistir    guest with the 30 s window: send, "Siparişi değiştir · n sn", quantity 2, kaydet; + b-mutfak (after the window).
 *   c-ayar-onay   owner: same page → "QR siparişlerinde garson onayı" on (the change window off again, off camera).
 *   c-onay        guest sends, the waiter's tablet approves (c-garson), the guest sees "Onaylandı".
 *   d-ayar-qr     owner: sidebar "QR siparişleri" → Durdur … (meanwhile d-durdu: the guest's cart) … Siparişleri aç.
 *   e-cagri       guest: Garson çağır → waiter tablet (e-garson); Hesabı iste → Kart → counter screen (e-kasa).
 *   f-yazdir      owner: Ayarlar → Masalar ve QR → QR kodlarını yazdır → A6 masa standı; plus the printed sheets.
 *   g-rapor       owner: Satış ve Raporlar → 30 gün → Detaylı göster → Personel, "Müşterilerin kendi verdiği siparişler".
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import QRCode from 'qrcode';
import { DESKTOP, PHONE, ROOT, Recorder, TABLET, imagesOnScreen, kit, pause, qrCameraHtml, smoothScroll } from './kayit-ortak';

const OUT = join(ROOT, '.local', 'sosyal', 'youtube', 'kayit');
const args = process.argv.slice(2), serverOnly = args.includes('--sunucu'), only = args.filter(a => !a.startsWith('--'));
const attach = !!process.env.SOSYAL_BAGLAN;
const reuse = process.env.SOSYAL_RUN;
const run = reuse ?? join(ROOT, '.local', 'sosyal', 'youtube', `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const k = kit({ run, reuse: !!reuse || attach, kafePort: 3721, merkezPort: 3797 });
mkdirSync(OUT, { recursive: true });

// The demo's live floor calmed and the settings between the clips: shared (scripts/sosyal/kayit-ortak.ts).
const { calm, setPrefs } = k;

// ---------- Guest steps ----------
const NO_POINTER = 'window.__molaNoFinger = true';
async function guestPhone() { const ctx = await k.phoneContext(); await ctx.addInitScript(NO_POINTER); return { ctx, page: await ctx.newPage() }; }
const card = (page: Page, name: string) => page.locator('.product-card', { hasText: name }).first();
/** "+" on Türk Kahvesi, (şeker Orta), Sepete ekle, the cart opened. */
async function addCoffee(page: Page, rec: Recorder, sugar = false) {
  await rec.tap(page, 'plus', card(page, 'Türk Kahvesi').locator('.add-circle'), { hold: 1300 });
  if (sugar) await rec.tap(page, 'sugar', page.getByRole('dialog').getByText(/^Orta$/).first(), { hold: 700 });
  await rec.tap(page, 'add', page.getByRole('button', { name: /Sepete ekle/ }), { hold: 1000 });
  await rec.tap(page, 'cart', page.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }), { hold: 1500 });
}
async function send(page: Page, rec: Recorder) {
  await rec.tap(page, 'send', page.getByRole('button', { name: 'Siparişi gönder', exact: true }), { hold: 100 });
  await page.getByText(/Siparişiniz alındı|Afiyet olsun|onayına gönderildi/).first().waitFor();
  rec.mark('sent');
}
/** The menu open on the products (for the clips that do not start at the QR stand). */
async function menuAt(page: Page, token: string) {
  await k.openMenu(page, token);
  await smoothScroll(page, 330, 10); await pause(page, 600); await imagesOnScreen(page);
}
const camera = async (page: Page, token: string, tableName: string) => {
  const qr = await QRCode.toDataURL(k.guestUrl(token), { margin: 1, width: 360, color: { dark: '#163328', light: '#ffffff' } });
  await page.setContent(qrCameraHtml(qr, tableName));
  await pause(page, 300);
};
/** The owner's screen (1280×800), Masalar first, as after signing in. */
const ownerScreen = () => k.staffScreen('isletme', 'desktop');
async function goSettings(page: Page, rec: Recorder, topic: string, part?: string) {
  await rec.tap(page, 'ayarlar', page.getByRole('button', { name: 'Ayarlar', exact: true }), { hold: 1100 });
  await rec.tap(page, 'topic', page.getByRole('button', { name: topic, exact: true }).first(), { hold: 1100 });
  if (part) await rec.tap(page, 'part', page.getByRole('button', { name: part, exact: true }).last(), { hold: 1100 });
}
const settingRow = (page: Page, label: string) => page.locator('.settings-row', { has: page.getByText(label, { exact: true }) }).first();
/** Ayarlar → Sipariş ve mutfak → Sipariş ve onay, the switch of `label` turned on. */
async function switchOn(page: Page, rec: Recorder, label: string) {
  await goSettings(page, rec, 'Sipariş ve mutfak');
  await page.getByText(label, { exact: true }).first().evaluate(e => e.scrollIntoView({ block: 'center' }));
  await pause(page, 900);
  await rec.look(page, 'row', settingRow(page, label), 2200);
  await rec.tap(page, 'toggle', settingRow(page, label).locator('.settings-toggle'), { hold: 300 });
  await page.waitForFunction(l => { const el = [...document.querySelectorAll('label')].find(x => x.textContent === l); const box = el && document.getElementById(el.htmlFor) as HTMLInputElement | null; return !!box?.checked; }, label);
  rec.mark('on');
  await pause(page, 1000);
}

// ---------- The clips ----------
type Clip = { name: string; play: (browser: Browser) => Promise<void> };
const clips: Clip[] = [];
const clip = (name: string, play: Clip['play']) => clips.push({ name, play });
let changeTable = '';

clip('a-siparis', async browser => {
  await setPrefs(browser, { waiterApproval: false, changeSeconds: 0, qrOpen: true });
  await calm(browser, true);
  const table = await k.freeTable(browser, 'Masa 04');
  const kitchen = await k.staffScreen('mutfak', 'desktop');
  const { ctx, page } = await guestPhone();
  await camera(page, table.token, table.name);
  const rec = new Recorder(page, join(OUT, 'a-siparis'), PHONE), recK = new Recorder(kitchen.page, join(OUT, 'a-mutfak'), DESKTOP);
  await rec.start(); await recK.start();
  await pause(page, 3400);
  rec.mark('menu');
  await page.goto(k.guestUrl(table.token));
  await page.getByRole('button', { name: /Türk Kahvesi/ }).first().waitFor();
  await imagesOnScreen(page);
  rec.mark('menuReady');
  await pause(page, 2800);
  await smoothScroll(page, 330, 1300); await pause(page, 1200);
  rec.mark('products');
  await addCoffee(page, rec, true);
  rec.mark('cartOpen');
  await send(page, rec);
  await kitchen.page.locator('.kitchen-card', { hasText: table.name }).first().waitFor({ timeout: 20000 });
  rec.mark('kitchen');
  await recK.box('ticket', kitchen.page.locator('.kitchen-card', { hasText: table.name }).first());
  await pause(page, 3000);
  await rec.tap(page, 'track', page.getByRole('button', { name: 'Siparişimi takip et' }), { hold: 1200 });
  rec.mark('orders');
  await rec.look(page, 'order', page.locator('article, section, div', { has: page.getByText(/^Sipariş #\d+$/) }).filter({ hasText: 'Türk Kahvesi' }).last(), 2600);
  await pause(page, 800);
  await recK.stop(); await rec.stop();
  writeFileSync(join(OUT, 'a-siparis', 'masa.txt'), table.name);
  await ctx.close(); await kitchen.ctx.close();
});

clip('a-ayar-sure', async browser => {
  await setPrefs(browser, { waiterApproval: false, changeSeconds: 0 });
  const owner = await ownerScreen(), page = owner.page;
  const rec = new Recorder(page, join(OUT, 'a-ayar-sure'), DESKTOP);
  await rec.start();
  await pause(page, 1400);
  await switchOn(page, rec, 'Müşteri siparişini değiştirip iptal edebilsin');
  await rec.look(page, 'seconds', settingRow(page, 'Sipariş değişiklik süresi (saniye)'), 3000);
  await pause(page, 600);
  await rec.stop();
  await owner.ctx.close();
});

clip('b-degistir', async browser => {
  await setPrefs(browser, { waiterApproval: false, changeSeconds: 30 });
  await calm(browser, true);
  const table = await k.freeTable(browser); changeTable = table.token;
  const kitchen = await k.staffScreen('mutfak', 'desktop');
  const { ctx, page } = await guestPhone();
  await menuAt(page, table.token);
  const rec = new Recorder(page, join(OUT, 'b-degistir'), PHONE), recK = new Recorder(kitchen.page, join(OUT, 'b-mutfak'), DESKTOP);
  await rec.start(); await recK.start();
  await pause(page, 1200);
  await addCoffee(page, rec);
  await send(page, rec);
  await pause(page, 500);
  await rec.look(page, 'window', page.getByText(/sn içinde değiştirebilirsiniz/).first(), 2000);
  await rec.tap(page, 'track', page.getByRole('button', { name: 'Siparişimi takip et' }), { hold: 900 });
  rec.mark('orders');
  await rec.tap(page, 'change', page.getByRole('button', { name: /Siparişi değiştir/ }), { hold: 1100 });
  const qty = page.getByRole('dialog').getByLabel('Adet').first();
  await rec.tap(page, 'qty', qty, { hold: 200 });
  await qty.fill('2'); await pause(page, 1100);
  await rec.tap(page, 'save', page.getByRole('button', { name: 'Değişiklikleri kaydet' }), { hold: 200 });
  await page.getByText(/Siparişiniz güncellendi/).first().waitFor({ timeout: 10000 }).catch(() => {});
  rec.mark('changed');
  await pause(page, 900);
  await page.evaluate('scrollTo({ top: 0, behavior: "smooth" })'); await pause(page, 1200);
  const cancel = page.getByRole('button', { name: /Siparişi iptal et/ }).first();
  if (await cancel.isVisible().catch(() => false)) await rec.look(page, 'cancel', cancel, 2200);
  await kitchen.page.locator('.kitchen-card', { hasText: table.name }).first().waitFor({ timeout: 60000 });
  rec.mark('kitchen');
  await recK.box('ticket', kitchen.page.locator('.kitchen-card', { hasText: table.name }).first());
  await pause(page, 3500);
  await recK.stop(); await rec.stop();
  writeFileSync(join(OUT, 'b-degistir', 'masa.txt'), table.name);
  await ctx.close(); await kitchen.ctx.close();
});

clip('c-ayar-onay', async browser => {
  await setPrefs(browser, { waiterApproval: false, changeSeconds: 0 });
  const owner = await ownerScreen(), page = owner.page;
  const rec = new Recorder(page, join(OUT, 'c-ayar-onay'), DESKTOP);
  await rec.start();
  await pause(page, 1400);
  await switchOn(page, rec, 'QR siparişlerinde garson onayı');
  await pause(page, 1600);
  await rec.stop();
  await owner.ctx.close();
});

clip('c-onay', async browser => {
  await setPrefs(browser, { waiterApproval: true, changeSeconds: 0 });
  await calm(browser, true);
  const table = await k.freeTable(browser);
  const waiter = await k.staffScreen('garson', 'tablet');
  const { ctx, page } = await guestPhone();
  await menuAt(page, table.token);
  const rec = new Recorder(page, join(OUT, 'c-onay'), PHONE), recW = new Recorder(waiter.page, join(OUT, 'c-garson'), TABLET);
  await rec.start(); await recW.start();
  await pause(page, 1200);
  await addCoffee(page, rec);
  await send(page, rec);
  await pause(page, 500);
  await rec.look(page, 'waiting', page.getByText(/garson onayına gönderildi/).last(), 2400);
  // The waiter's tablet: the order waiting for approval.
  const compact = waiter.page.getByTestId('approval-compact');
  const approve = waiter.page.getByRole('button', { name: 'Onayla ve mutfağa gönder' }).first();
  await approve.or(compact).first().waitFor({ timeout: 20000 });
  rec.mark('waiter');
  await pause(waiter.page, 700);
  if (await compact.isVisible().catch(() => false)) await recW.tap(waiter.page, 'show', compact, { hold: 1200 });
  await recW.look(waiter.page, 'queue', waiter.page.locator('section, .panel, article', { has: approve }).last(), 2200);
  await recW.tap(waiter.page, 'approve', approve, { hold: 1200 });
  rec.mark('approved');
  await page.getByText(/Onaylandı/).first().waitFor({ timeout: 15000 }).catch(() => {});
  rec.mark('guestApproved');
  await pause(page, 600);
  await rec.look(page, 'ok', page.getByText(/Onaylandı/).last(), 2400);
  await recW.stop(); await rec.stop();
  await setPrefs(browser, { waiterApproval: false });
  await ctx.close(); await waiter.ctx.close();
});

clip('d-ayar-qr', async browser => {
  await setPrefs(browser, { qrOpen: true, waiterApproval: false, changeSeconds: 0 });
  await calm(browser, true);
  const table = await k.freeTable(browser);
  const owner = await ownerScreen(), page = owner.page;
  const rec = new Recorder(page, join(OUT, 'd-ayar-qr'), DESKTOP);
  await rec.start();
  await pause(page, 1400);
  await rec.look(page, 'card', page.getByTestId('qr-ordering-card'), 2200);
  await rec.tap(page, 'stop', page.getByTestId('qr-ordering-stop'), { hold: 1400 });
  await rec.tap(page, 'confirm', page.getByRole('dialog').getByRole('button', { name: 'Durdur', exact: true }), { hold: 600 });
  await page.getByTestId('qr-ordering-open').waitFor();
  rec.mark('stopped');
  await pause(page, 400);
  await rec.look(page, 'closed', page.getByTestId('qr-ordering-card'), 2600);
  rec.mark('guestFrom');
  // Meanwhile the guest's phone.
  const { ctx, page: g } = await guestPhone();
  await menuAt(g, table.token);
  const recG = new Recorder(g, join(OUT, 'd-durdu'), PHONE);
  await recG.start();
  await pause(g, 1200);
  await addCoffee(g, recG);
  await recG.look(g, 'notice', g.getByText(/Şu an sipariş almıyoruz/).last(), 1400);
  await recG.look(g, 'sendOff', g.getByRole('button', { name: 'Siparişi gönder', exact: true }), 2200);
  await pause(g, 500);
  await recG.stop();
  await ctx.close();
  rec.mark('guestTo');
  await pause(page, 800);
  await rec.tap(page, 'reopen', page.getByTestId('qr-ordering-open'), { hold: 600 });
  await page.getByTestId('qr-ordering-stop').waitFor();
  rec.mark('reopened');
  await pause(page, 400);
  await rec.look(page, 'open', page.getByTestId('qr-ordering-card'), 2200);
  await rec.stop();
  await owner.ctx.close();
});

clip('e-cagri', async browser => {
  await setPrefs(browser, { qrOpen: true });
  await calm(browser, true);
  // The table of the change example (its order is on the bill).
  const token = changeTable || (await k.freeTable(browser)).token;
  const api = await k.ownerApi(browser), st = await k.state(api.req); await api.close();
  const table = st.tables.find(t => t.token === token)!;
  const waiter = await k.staffScreen('garson', 'tablet');
  const kasa = await k.staffScreen('kasiyer', 'desktop');
  const { ctx, page } = await guestPhone();
  await k.openMenu(page, token); await page.evaluate('scrollTo(0, 0)'); await pause(page, 600);
  const rec = new Recorder(page, join(OUT, 'e-cagri'), PHONE), recW = new Recorder(waiter.page, join(OUT, 'e-garson'), TABLET), recC = new Recorder(kasa.page, join(OUT, 'e-kasa'), DESKTOP);
  await rec.start(); await recW.start(); await recC.start();
  await pause(page, 1200);
  await rec.tap(page, 'call', page.getByRole('button', { name: 'Garson çağır' }), { hold: 300 });
  await page.getByRole('button', { name: 'Garson çağrıldı' }).waitFor();
  rec.mark('called');
  await pause(page, 1800);
  await waiter.page.locator('.service-call-chip').first().waitFor({ timeout: 15000 });
  rec.mark('waiter');
  await pause(waiter.page, 600);
  await recW.look(waiter.page, 'chip', waiter.page.locator('.service-call-chip').first(), 2400);
  await recW.tap(waiter.page, 'close', waiter.page.getByRole('button', { name: new RegExp(`${table.name} çağrısını kapat`) }), { hold: 1200 });
  rec.mark('answered');
  await page.getByRole('button', { name: 'Garson çağır' }).waitFor({ timeout: 15000 }).catch(() => {});
  await pause(page, 1200);
  rec.mark('billFrom');
  await rec.tap(page, 'bill', page.getByRole('button', { name: 'Hesabı iste' }), { hold: 1000 });
  await rec.tap(page, 'card', page.getByRole('group', { name: 'Nasıl ödeyeceksiniz?' }).getByRole('button', { name: 'Kart' }), { hold: 300 });
  await page.getByRole('button', { name: 'Hesap istendi' }).waitFor();
  rec.mark('billAsked');
  await pause(page, 1800);
  await kasa.page.locator('.service-call-chip').first().waitFor({ timeout: 15000 });
  rec.mark('kasa');
  await pause(kasa.page, 600);
  await recC.look(kasa.page, 'chip', kasa.page.locator('.service-call-chip').first(), 2600);
  await recC.look(kasa.page, 'tile', kasa.page.locator('.table-card', { hasText: table.name }).first(), 2200);
  await pause(page, 600);
  for (const r of [recC, recW, rec]) await r.stop();
  writeFileSync(join(OUT, 'e-cagri', 'masa.txt'), table.name);
  await ctx.close(); await waiter.ctx.close(); await kasa.ctx.close();
});

clip('f-yazdir', async browser => {
  const owner = await ownerScreen(), page = owner.page;
  const rec = new Recorder(page, join(OUT, 'f-yazdir'), DESKTOP);
  await rec.start();
  await pause(page, 1200);
  await goSettings(page, rec, 'Masalar ve QR', 'QR kodlarını yazdır');
  await pause(page, 600);
  await rec.tap(page, 'a6', page.getByRole('button', { name: /A6 masa standı/ }), { hold: 1200 });
  await rec.look(page, 'paper', page.locator('.qr-stand-paper').first(), 2000);
  await rec.look(page, 'print', page.locator('.qr-print-card .settings-actions').first(), 2000);
  await rec.stop();
  await owner.ctx.close();
  // The printed sheets (the page as Chrome prints it): A4 with 6 codes and the A6 table stand card.
  mkdirSync(join(OUT, 'baski'), { recursive: true });
  for (const [file, layout, paper] of [['a4-6', '6 QR', ''], ['a6-stand', /A6 masa standı/, 'A6 kâğıda tek']] as const) {
    const s = await k.staffScreen('isletme', 'desktop');
    await s.page.addInitScript('window.print = function () {}');
    await s.page.reload(); await pause(s.page, 1200);
    await s.page.getByRole('button', { name: 'Ayarlar', exact: true }).click(); await pause(s.page, 600);
    await s.page.getByRole('button', { name: 'Masalar ve QR', exact: true }).first().click(); await pause(s.page, 600);
    await s.page.getByRole('button', { name: 'QR kodlarını yazdır', exact: true }).last().click(); await pause(s.page, 800);
    await s.page.getByRole('button', { name: layout }).first().click(); await pause(s.page, 400);
    if (paper) { await s.page.getByRole('button', { name: paper }).click(); await pause(s.page, 400); }
    await s.page.getByRole('button', { name: 'Yazdır', exact: true }).click();
    await s.page.getByTestId('qr-print-sheet').waitFor({ state: 'attached', timeout: 20000 });
    await pause(s.page, 1500);
    await s.page.emulateMedia({ media: 'print' });
    await pause(s.page, 800);
    await s.page.locator(paper ? '.qr-stand-page' : '.qr-sheet').first().screenshot({ path: join(OUT, 'baski', `${file}.png`) });
    await s.ctx.close();
  }
});

clip('g-rapor', async () => {
  const owner = await ownerScreen(), page = owner.page;
  const rec = new Recorder(page, join(OUT, 'g-rapor'), DESKTOP);
  await rec.start();
  await pause(page, 900);
  await rec.tap(page, 'rapor', page.getByRole('button', { name: 'Satış ve Raporlar', exact: true }), { lead: 1100, hold: 900 });
  await rec.tap(page, 'range', page.getByRole('button', { name: '30 gün', exact: true }), { lead: 1100, hold: 700 });
  await rec.tap(page, 'detail', page.getByRole('button', { name: 'Detaylı göster' }), { lead: 1100, hold: 700 });
  await rec.tap(page, 'staff', page.getByRole('button', { name: 'Personel', exact: true }).last(), { lead: 1100, hold: 1200 });
  await rec.look(page, 'donut', page.locator('.self-service-report').first(), 3600);
  await rec.stop();
  await owner.ctx.close();
});

async function main() {
  const browser = await k.launch();
  try {
    if (!attach) { await k.startServers(); await k.prepareMenu(browser, { waiterApproval: false, changeSeconds: 0 }); await calm(browser); }
    if (serverOnly) { console.log(`Hazır: ${k.KAFE} (kafe), ${k.MERKEZ} (Merkez). Klasör: ${run}`); await new Promise(() => {}); }
    const chosen = only.length ? clips.filter(c => only.includes(c.name)) : clips;
    for (const c of chosen) { console.log(`Kayıt: ${c.name}`); await c.play(browser); }
  } finally { await k.close(); }
}
await main();
