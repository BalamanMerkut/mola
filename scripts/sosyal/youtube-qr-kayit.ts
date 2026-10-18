/*
 * YouTube pilot 1 "QR menü ve QR sipariş": recordings of the REAL app (shared parts: scripts/sosyal/kayit-ortak.ts).
 * A fresh Mola Merkez and demo café ("Mola Örnek Kafe") per run in .local/sosyal/youtube/run-<zaman>/; the demo's live floor is
 * calmed first (pending QR approvals, cancel requests and calls answered, open orders served, the cash day opened), so only
 * the clip's own orders and calls appear on the staff screens.
 *
 *   npx tsx scripts/sosyal/youtube-qr-kayit.ts                       all clips
 *   npx tsx scripts/sosyal/youtube-qr-kayit.ts ana onay              only these (ana, qr, onay, sure, yazdir)
 *   npx tsx scripts/sosyal/youtube-qr-kayit.ts --sunucu              only start + prepare the servers and keep them open
 *   SOSYAL_BAGLAN=1 …                                                use servers already started by `--sunucu`
 *
 * Ports: café 3721, Mola Merkez 3797. Needs `npm run build`. Output: .local/sosyal/youtube/kayit/<klip>/ (meta.json: frames,
 * marks, boxes) and kayit/baski/*.png (the printed QR sheets). scripts/sosyal/youtube-kurgu.ts makes the video.
 *
 * Clips
 *   ana            guest phone + waiter phone + kitchen screen + counter screen at once: scan, menu, EN/TR, Türk kahvesi
 *                  (şeker: Orta), send, Siparişlerim, change within the 30 s window, kitchen gets it after the window,
 *                  Garson çağır, Hesabı iste → Kart. Chapters 1 and 2 of the video are both cut from it.
 *   ayar-qr        owner: the sidebar card "QR siparişleri açık" → Durdur → confirm → closed → Siparişleri aç.
 *   qr-acik / qr-durdu          the same guest order with QR ordering open / stopped.
 *   ayar-onay      owner: Ayarlar → Sipariş ve mutfak → Sipariş ve onay → "QR siparişlerinde garson onayı" on.
 *   onay-kapali / onay-acik     guest + waiter phone, approval off / on (the waiter approves).
 *   ayar-sure      owner: same page → "Müşteri siparişini değiştirip iptal edebilsin" on (30 saniye).
 *   sure-kapali / sure-acik     guest + kitchen screen, change window off / 30 s.
 *   ayar-yazdir    owner: Ayarlar → Masalar ve QR → QR kodlarını yazdır → A6 masa standı; plus the printed sheets.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import QRCode from 'qrcode';
import { DESKTOP, PHONE, ROOT, Recorder, imagesOnScreen, kit, pause, press, qrCameraHtml, smoothScroll, type Kit } from './kayit-ortak';

const OUT = join(ROOT, '.local', 'sosyal', 'youtube', 'kayit');
const args = process.argv.slice(2), serverOnly = args.includes('--sunucu'), only = args.filter(a => !a.startsWith('--'));
const attach = !!process.env.SOSYAL_BAGLAN;
const reuse = process.env.SOSYAL_RUN;
const run = reuse ?? join(ROOT, '.local', 'sosyal', 'youtube', `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const k = kit({ run, reuse: !!reuse || attach, kafePort: 3721, merkezPort: 3797 });
mkdirSync(OUT, { recursive: true });

// ---------- The demo's live floor, calmed ----------
async function calm(browser: Browser, quiet = false) {
  const api = await k.ownerApi(browser), req = api.req;
  const s = await k.state(req);
  const tryPost = async (path: string, body: unknown) => { try { await k.post(req, path, body); return true; } catch { return false; } };
  for (const o of s.orders.filter(o => o.status === 'awaiting_approval')) await tryPost('/api/staff/orders/review', { requestId: randomUUID(), orderId: o.id, version: o.version, approve: true });
  for (const o of (await k.state(req)).orders.filter(o => o.cancelRequested)) await tryPost('/api/staff/cancel', { requestId: randomUUID(), orderId: o.id, version: o.version, stockUsed: false });
  for (const step of ['preparing', 'ready', 'served'] as const)
    for (const o of (await k.state(req)).orders.filter(o => !['served', 'cancelled', 'rejected'].includes(o.status)))
      await tryPost('/api/staff/status', { requestId: randomUUID(), orderId: o.id, version: o.version, status: step });
  for (const c of (await k.state(req)).serviceCalls) await tryPost('/api/staff/calls/resolve', { callId: c.id });
  await tryPost('/api/staff/first-steps', { step: 'dismiss' });
  await api.close();
  if (quiet) return;
  // The cash day opened by the cashier (the counter screen's "Kasa açılışı" card goes away).
  const ctx = await browser.newContext(), p = await ctx.newPage();
  await k.login(p, 'kasiyer');
  await k.post(p.request, '/api/staff/cash/open', { requestId: randomUUID(), amount: 50000 }).catch(() => {});
  await ctx.close();
  const check = await k.ownerApi(browser), after = await k.state(check.req);
  await check.close();
  console.log(`Salon sakin: açık sipariş ${after.orders.filter(o => !['served', 'cancelled', 'rejected'].includes(o.status)).length}, çağrı ${after.serviceCalls.length}`);
}
async function setPrefs(browser: Browser, patch: { waiterApproval?: boolean; changeSeconds?: number; qrOpen?: boolean }) {
  const api = await k.ownerApi(browser);
  if (patch.waiterApproval !== undefined || patch.changeSeconds !== undefined) await k.settings(api.req, patch);
  if (patch.qrOpen !== undefined) await k.post(api.req, '/api/staff/qr-ordering', { requestId: randomUUID(), open: patch.qrOpen });
  await api.close();
}

// ---------- Guest steps ----------
/** Türk kahvesi, şeker Orta, into the cart, the cart opened (the guest's usual order in every clip). */
async function orderCoffee(page: Page, rec: Recorder, o: { hold?: number } = {}) {
  rec.mark('product');
  await press(page, page.getByRole('button', { name: /Türk Kahvesi/ }).first(), { hold: o.hold ?? 1400 });
  rec.mark('sugar');
  await press(page, page.getByRole('dialog').getByText(/^Orta$/).first(), { hold: 900 });
  rec.mark('add');
  await press(page, page.getByRole('button', { name: /Sepete ekle/ }), { hold: 1100 });
  rec.mark('cart');
  await press(page, page.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }), { hold: 1800 });
}
async function send(page: Page, rec: Recorder) {
  rec.mark('send');
  await press(page, page.getByRole('button', { name: 'Siparişi gönder', exact: true }), { hold: 200 });
  await page.getByText(/Siparişiniz alındı|Afiyet olsun|onayına gönderildi/).first().waitFor();
  rec.mark('sent');
}
const camera = async (page: Page, token: string, tableName: string) => {
  const qr = await QRCode.toDataURL(k.guestUrl(token), { margin: 1, width: 360, color: { dark: '#163328', light: '#ffffff' } });
  await page.setContent(qrCameraHtml(qr, tableName));
  await pause(page, 300);
};

// ---------- The clips ----------
type Clip = { name: string; group: string; play: (browser: Browser) => Promise<void> };
const clips: Clip[] = [];
const clip = (name: string, group: string, play: Clip['play']) => clips.push({ name, group, play });

clip('ana', 'ana', async browser => {
  await setPrefs(browser, { waiterApproval: false, changeSeconds: 30, qrOpen: true });
  const table = await k.freeTable(browser, 'Masa 04');
  const waiter = await k.staffScreen('garson', 'phone');
  const kitchen = await k.staffScreen('mutfak', 'desktop');
  const kasa = await k.staffScreen('kasiyer', 'desktop');
  const ctx = await k.phoneContext(), page = await ctx.newPage();
  await camera(page, table.token, table.name);
  const rec = new Recorder(page, join(OUT, 'ana'), PHONE);
  const recW = new Recorder(waiter.page, join(OUT, 'ana-garson'), PHONE);
  const recK = new Recorder(kitchen.page, join(OUT, 'ana-mutfak'), DESKTOP);
  const recC = new Recorder(kasa.page, join(OUT, 'ana-kasa'), DESKTOP);
  for (const r of [rec, recW, recK, recC]) await r.start();
  await pause(page, 3400);
  // 1. The menu
  rec.mark('menu');
  await page.goto(k.guestUrl(table.token));
  await page.getByRole('button', { name: /Türk Kahvesi/ }).first().waitFor();
  await imagesOnScreen(page);
  rec.mark('menuReady');
  await pause(page, 3000);
  rec.mark('categories');
  await press(page, page.getByRole('button', { name: 'Tatlılar', exact: true }), { hold: 600 });
  await imagesOnScreen(page);
  await pause(page, 1200);
  await smoothScroll(page, 420, 1400); await pause(page, 1600);
  await smoothScroll(page, -420, 1000); await pause(page, 400);
  await press(page, page.getByRole('button', { name: 'Tümü', exact: true }), { hold: 1200 });
  rec.mark('search');
  const search = page.getByPlaceholder(/Ürün adı veya kodu/);
  await press(page, search, { hold: 300 });
  await search.pressSequentially('limon', { delay: 170 });
  await pause(page, 600); await imagesOnScreen(page); await pause(page, 1800);
  await search.fill(''); await pause(page, 300);
  await page.mouse.click(5, 5); await pause(page, 900);
  rec.mark('english');
  await press(page, page.getByRole('button', { name: 'EN', exact: true }), { hold: 2600 });
  rec.mark('turkish');
  await press(page, page.getByRole('button', { name: 'TR', exact: true }), { hold: 1600 });
  await smoothScroll(page, 330, 1100); await pause(page, 700);
  // 2. The order
  await orderCoffee(page, rec);
  await send(page, rec);
  await waiter.page.getByRole('button', { name: new RegExp(`^${table.name} · .*Yeni sipariş`) }).first().waitFor({ timeout: 15000 }).catch(() => {});
  rec.mark('waiterOrder');
  await recW.box('tile', waiter.page.getByRole('button', { name: new RegExp(`^${table.name} · `) }).first());
  await recC.box('tileOrder', kasa.page.locator('.table-card', { hasText: table.name }).first());
  await pause(page, 2600);
  rec.mark('track');
  await press(page, page.getByRole('button', { name: 'Siparişimi takip et' }), { hold: 2000 });
  await rec.box('change', page.getByRole('button', { name: /Siparişi değiştir/ }));
  rec.mark('change');
  await press(page, page.getByRole('button', { name: /Siparişi değiştir/ }), { hold: 1600 });
  const qty = page.getByRole('dialog').getByLabel('Adet').first();
  rec.mark('qty');
  await press(page, qty, { hold: 300 });
  await qty.fill('2'); await pause(page, 1500);
  rec.mark('save');
  await press(page, page.getByRole('button', { name: 'Değişiklikleri kaydet' }), { hold: 200 });
  await page.getByText(/Siparişiniz güncellendi/).first().waitFor({ timeout: 10000 }).catch(() => {});
  rec.mark('changed');
  await pause(page, 1200);
  await page.evaluate(`new Promise(function (done) { var start = scrollY, t0 = performance.now(); function step(t) { var k = Math.min(1, (t - t0) / 900); scrollTo(0, start * (1 - (k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2))); if (k < 1) requestAnimationFrame(step); else done(); } requestAnimationFrame(step); })`);
  rec.mark('top');
  // The window ends: the order reaches the kitchen screen.
  await kitchen.page.getByText(table.name).first().waitFor({ timeout: 60000 });
  rec.mark('kitchen');
  await recK.box('ticket', kitchen.page.locator('.kitchen-card', { hasText: table.name }).first());
  await pause(page, 3500);
  // 3. Garson çağır
  await page.evaluate('scrollTo(0, 0)'); await pause(page, 600);
  rec.mark('call');
  await press(page, page.getByRole('button', { name: 'Garson çağır' }), { hold: 300 });
  await page.getByRole('button', { name: 'Garson çağrıldı' }).waitFor();
  rec.mark('called');
  await waiter.page.locator('.service-call-chip').first().waitFor({ timeout: 15000 });
  rec.mark('waiterSees');
  await recW.box('chip', waiter.page.locator('.service-call-chip').first());
  await pause(page, 4500);
  const close = waiter.page.getByRole('button', { name: new RegExp(`${table.name} çağrısını kapat`) });
  rec.mark('answer');
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.getByRole('button', { name: 'Garson çağır' }).waitFor({ timeout: 15000 }).catch(() => {});
  rec.mark('answered');
  await pause(page, 2500);
  // 4. Hesabı iste → Kart
  rec.mark('bill');
  await press(page, page.getByRole('button', { name: 'Hesabı iste' }), { hold: 1600 });
  rec.mark('pay');
  await press(page, page.getByRole('group', { name: 'Nasıl ödeyeceksiniz?' }).getByRole('button', { name: 'Kart' }), { hold: 300 });
  await page.getByRole('button', { name: 'Hesap istendi' }).waitFor();
  rec.mark('billAsked');
  await kasa.page.locator('.service-call-chip').first().waitFor({ timeout: 15000 });
  rec.mark('kasaSees');
  await recC.box('chip', kasa.page.locator('.service-call-chip').first());
  await recC.box('tile', kasa.page.locator('.table-card', { hasText: table.name }).first());
  await recK.box('ticketEnd', kitchen.page.locator('.kitchen-card', { hasText: table.name }).first());
  await pause(page, 6000);
  for (const r of [recC, recK, recW, rec]) await r.stop();
  writeFileSync(join(OUT, 'ana', 'masa.txt'), table.name);
  await ctx.close(); await waiter.ctx.close(); await kitchen.ctx.close(); await kasa.ctx.close();
});

/** The owner's screen (1280×800, with the pointer): Masalar first, as after signing in. */
async function ownerScreen() {
  const s = await k.staffScreen('isletme', 'desktop', true);
  await s.page.mouse.move(700, 420);
  return s;
}
async function goSettings(page: Page, rec: Recorder, topic: string, part?: string) {
  rec.mark('nav');
  await press(page, page.getByRole('button', { name: 'Ayarlar', exact: true }), { hold: 1400, steps: 24 });
  rec.mark('topic');
  await press(page, page.getByRole('button', { name: topic, exact: true }).first(), { hold: 1400, steps: 24 });
  if (part) { rec.mark('part'); await press(page, page.getByRole('button', { name: part, exact: true }).last(), { hold: 1200, steps: 24 }); }
}

clip('ayar-qr', 'qr', async browser => {
  await setPrefs(browser, { qrOpen: true });
  const owner = await ownerScreen(), page = owner.page;
  const rec = new Recorder(page, join(OUT, 'ayar-qr'), DESKTOP);
  await rec.start();
  await pause(page, 1800);
  await rec.box('card', page.getByTestId('qr-ordering-card'));
  rec.mark('card');
  await page.mouse.move(150, 150, { steps: 24 }); await pause(page, 2200);
  rec.mark('stop');
  await press(page, page.getByTestId('qr-ordering-stop'), { hold: 1600 });
  await rec.box('dialog', page.getByRole('dialog'));
  rec.mark('confirm');
  await press(page, page.getByRole('dialog').getByRole('button', { name: 'Durdur', exact: true }), { hold: 600 });
  await page.getByTestId('qr-ordering-open').waitFor();
  rec.mark('stopped');
  await rec.box('cardClosed', page.getByTestId('qr-ordering-card'));
  await pause(page, 3800);
  rec.mark('reopen');
  await press(page, page.getByTestId('qr-ordering-open'), { hold: 600 });
  await page.getByTestId('qr-ordering-stop').waitFor();
  rec.mark('reopened');
  await pause(page, 2500);
  await rec.stop();
  await owner.ctx.close();
});

/** Guest orders a Türk kahvesi and tries to send it (QR ordering open or stopped). */
async function guestOrderClip(browser: Browser, name: string, o: { qrOpen?: boolean; staff?: { user: string; kind: 'phone' | 'desktop'; after?: (p: Page, rec: Recorder, table: string) => Promise<void> } ; afterSend?: (p: Page, rec: Recorder) => Promise<void>; tail?: number }) {
  await calm(browser, true);
  const table = await k.freeTable(browser);
  const watcher = await k.staffScreen(o.staff?.user ?? 'mutfak', o.staff?.kind ?? 'desktop');
  if (o.qrOpen === false) await setPrefs(browser, { qrOpen: false });
  const ctx = await k.phoneContext(), page = await ctx.newPage();
  await k.openMenu(page, table.token);
  await smoothScroll(page, 330, 10); await pause(page, 600); await imagesOnScreen(page);
  const rec = new Recorder(page, join(OUT, name), PHONE);
  const recS = o.staff ? new Recorder(watcher.page, join(OUT, `${name}-personel`), o.staff.kind === 'phone' ? PHONE : DESKTOP) : undefined;
  await rec.start(); await recS?.start();
  await pause(page, 1500);
  await orderCoffee(page, rec);
  if (o.qrOpen === false) {
    rec.mark('send');
    await rec.box('notice', page.getByText(/Şu an sipariş almıyoruz/).last());
    await rec.box('sendButton', page.getByRole('button', { name: 'Siparişi gönder', exact: true }));
    await page.getByRole('button', { name: 'Siparişi gönder', exact: true }).hover(); await pause(page, 600);
    rec.mark('sent');
  } else await send(page, rec);
  await o.afterSend?.(page, rec);
  if (o.staff?.after) await o.staff.after(watcher.page, rec, table.name);
  await pause(page, o.tail ?? 4000);
  await recS?.stop(); await rec.stop();
  writeFileSync(join(OUT, name, 'masa.txt'), table.name);
  if (o.qrOpen === false) await setPrefs(browser, { qrOpen: true });
  await ctx.close(); await watcher.ctx.close();
}
clip('qr-acik', 'qr', browser => guestOrderClip(browser, 'qr-acik', { qrOpen: true }));
clip('qr-durdu', 'qr', browser => guestOrderClip(browser, 'qr-durdu', { qrOpen: false }));

/** Owner turns a switch on in Ayarlar → Sipariş ve mutfak → Sipariş ve onay. */
async function switchClip(browser: Browser, name: string, label: string, before: { waiterApproval: boolean; changeSeconds: number }) {
  await setPrefs(browser, before);
  const owner = await ownerScreen(), page = owner.page;
  const rec = new Recorder(page, join(OUT, name), DESKTOP);
  await rec.start();
  await pause(page, 1500);
  await goSettings(page, rec, 'Sipariş ve mutfak', 'Sipariş ve onay');
  const sw = page.getByRole('checkbox', { name: label });
  // The row in the middle of the screen.
  await page.getByText(label, { exact: true }).first().evaluate(e => e.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await pause(page, 1400);
  rec.mark('row');
  const row = page.locator('.settings-row', { has: page.getByText(label, { exact: true }) }).first();
  await rec.box('row', row);
  await page.mouse.move(420, (await row.boundingBox())!.y + 20, { steps: 30 }); await pause(page, 2600);
  rec.mark('toggle');
  await press(page, sw, { hold: 300, steps: 30 });
  await page.waitForFunction(l => { const el = [...document.querySelectorAll('label')].find(x => x.textContent === l); const box = el && document.getElementById(el.htmlFor) as HTMLInputElement | null; return !!box?.checked; }, label);
  rec.mark('on');
  await pause(page, 900);
  const card = page.locator('.settings-card', { has: page.getByText(label, { exact: true }) }).first();
  await rec.box('rowOn', row); await rec.box('card', card);
  await pause(page, 4200);
  await rec.stop();
  await owner.ctx.close();
}
clip('ayar-onay', 'onay', browser => switchClip(browser, 'ayar-onay', 'QR siparişlerinde garson onayı', { waiterApproval: false, changeSeconds: 0 }));
const waiterSees = (approve: boolean) => async (w: Page, rec: Recorder, table: string) => {
  if (approve) {
    const show = w.getByTestId('approval-compact');
    await show.waitFor({ timeout: 15000 });
    rec.mark('waiterSees');
    await pause(w, 2600);
    rec.mark('waiterOpen');
    await w.evaluate('window.__molaNoFinger = false');
    await press(w, show, { hold: 1800 });
    rec.mark('approve');
    await press(w, w.getByRole('button', { name: 'Onayla ve mutfağa gönder' }).first(), { hold: 600 });
    rec.mark('approved');
  } else {
    await w.getByRole('button', { name: new RegExp(`^${table} · .*Yeni sipariş`) }).first().waitFor({ timeout: 15000 });
    await rec.box('tile', w.getByRole('button', { name: new RegExp(`^${table} · `) }).first());
    rec.mark('waiterSees');
    await pause(w, 4400);
    rec.mark('approved');
  }
};
clip('onay-kapali', 'onay', async browser => { await setPrefs(browser, { waiterApproval: false, changeSeconds: 0 }); await guestOrderClip(browser, 'onay-kapali', { staff: { user: 'garson', kind: 'phone', after: waiterSees(false) }, tail: 3000 }); });
clip('onay-acik', 'onay', async browser => { await setPrefs(browser, { waiterApproval: true, changeSeconds: 0 }); await guestOrderClip(browser, 'onay-acik', { staff: { user: 'garson', kind: 'phone', after: waiterSees(true) }, tail: 3000 }); await setPrefs(browser, { waiterApproval: false }); });

clip('ayar-sure', 'sure', browser => switchClip(browser, 'ayar-sure', 'Müşteri siparişini değiştirip iptal edebilsin', { waiterApproval: false, changeSeconds: 0 }));
const kitchenGets = async (kpage: Page, rec: Recorder, table: string) => {
  await kpage.getByText(table).first().waitFor({ timeout: 60000 });
  rec.mark('kitchen');
  await rec.box('ticket', kpage.locator('.kitchen-card', { hasText: table }).first());
};
clip('sure-kapali', 'sure', async browser => { await setPrefs(browser, { waiterApproval: false, changeSeconds: 0 }); await guestOrderClip(browser, 'sure-kapali', { staff: { user: 'mutfak', kind: 'desktop', after: kitchenGets },
  afterSend: async (p, rec) => { await pause(p, 1500); rec.mark('track'); await press(p, p.getByRole('button', { name: 'Siparişimi takip et' }), { hold: 600 }); }, tail: 4000 }); });
clip('sure-acik', 'sure', async browser => { await setPrefs(browser, { waiterApproval: false, changeSeconds: 30 }); await guestOrderClip(browser, 'sure-acik', { staff: { user: 'mutfak', kind: 'desktop', after: kitchenGets },
  afterSend: async (p, rec) => { await pause(p, 1500); rec.mark('track'); await press(p, p.getByRole('button', { name: 'Siparişimi takip et' }), { hold: 600 }); await rec.box('change', p.getByRole('button', { name: /Siparişi değiştir/ })); }, tail: 4000 }); });

clip('ayar-yazdir', 'yazdir', async browser => {
  const owner = await ownerScreen(), page = owner.page;
  const rec = new Recorder(page, join(OUT, 'ayar-yazdir'), DESKTOP);
  await rec.start();
  await pause(page, 1500);
  await goSettings(page, rec, 'Masalar ve QR', 'QR kodlarını yazdır');
  await pause(page, 1200);
  rec.mark('options');
  await rec.box('card', page.locator('.qr-print-card').first());
  await rec.box('layout', page.locator('.qr-per-page').first());
  await press(page, page.getByRole('button', { name: /A6 masa standı/ }), { hold: 1800, steps: 30 });
  await rec.box('layoutA6', page.locator('.qr-per-page').first());
  await rec.box('paper', page.locator('.qr-stand-paper').first());
  await rec.box('actions', page.locator('.qr-print-card .settings-actions').first());
  rec.mark('a6');
  await pause(page, 2600);
  await page.getByRole('button', { name: 'Yazdır', exact: true }).hover(); await pause(page, 2400);
  rec.mark('print');
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
    const sheet = s.page.locator(paper ? '.qr-stand-page' : '.qr-sheet').first();
    await sheet.screenshot({ path: join(OUT, 'baski', `${file}.png`) });
    await s.ctx.close();
  }
});

async function main() {
  const browser = await k.launch();
  try {
    if (!attach) { await k.startServers(); await k.prepareMenu(browser, { waiterApproval: false, changeSeconds: 30 }); await calm(browser); }
    if (serverOnly) { console.log(`Hazır: ${k.KAFE} (kafe), ${k.MERKEZ} (Merkez). Klasör: ${run}`); await new Promise(() => {}); }
    const chosen = only.length ? clips.filter(c => only.includes(c.name) || only.includes(c.group)) : clips;
    for (const c of chosen) { console.log(`Kayıt: ${c.name}`); await c.play(browser); }
  } finally { await k.close(); }
}
await main();
