/*
 * YouTube E4 "Müdür eğitimi" (training series, the Müdür's own screens): recordings of the REAL app on the café computer's
 * Mola window, signed in as a Müdür account (edit: scripts/sosyal/youtube-mudur-kurgu.ts). One run in story order on a fresh
 * Mola Merkez + demo café ("Mola Örnek Kafe", shared parts: scripts/sosyal/kayit-ortak.ts) in .local/sosyal/youtube/mudur/run-<zaman>/.
 *
 * What the Müdür has is packages/domain/roles.ts (MANAGER_CAN / MANAGER_CANNOT, src/roleNav.ts): the day's work and the business's
 * numbers, never Ayarlar, staff accounts, Entegrasyonlar or Destek. The video shows what is the Müdür's own (the waiter's and the
 * cashier's work is in E1 and E2).
 *
 * The run plays on the recording clock (kit({ saat })): the demo is made "yesterday evening", its floor settled and its kasa
 * closed by Zeynep Arslan (the demo's cashier: the expected cash counted when it is above ₺500, else ₺3.865; ₺500 left), off camera. The owner opens the
 * Müdür account "mudur" (Selin Koç). This morning the cashier opens the kasa and the waiter's orders come and are paid (off
 * camera); at 13:30 a few tables are open, Masa 08 has a wrong order, and the cashier asks for a refund above her limit (Masa 05,
 * one San Sebastian, ₺190). At 14:05 the Müdür signs in:
 *
 *   r1-giris     sign-in page: kullanıcı adı "mudur", şifre, "Çalışma alanını aç" → Masalar; the sidebar.
 *   r2-ozet      Masalar's line "Günün özeti" (açık masa, açık hesap, mutfakta, servise hazır), the kasa chip; "Açık".
 *   r3-iptal     Masa 08 → "İptal et" → one Ev Yapımı Limonata, "Yanlış sipariş" → "Seçilenleri iptal et".
 *   r4-tukendi   Menü yönetimi → search "Profiterol" → "Tükendi".   + q4-menu: the guest's menu (phone) shows it "Tükendi".
 *   r4-geri      "Tükendi" off again.
 *   r5-fiyat     search "Latte" → "Düzenle" → Fiyat 140 → 150 → "Kaydet ve yayınla".
 *   r6-iade      Kasa ve giderler → İadeler → "Bekleyen iade istekleri" → "İadeyi yap" → "İadeyi kaydet" → "Evet, iadeyi kaydet".
 *                + k6-kasa: the cashier's screen, "Müdür iadeyi yaptı: Masa 05 · ₺190 nakit. Parayı müşteriye verin."
 *   r7-qr        Masalar → the sidebar's "Durdur" → "QR siparişlerini durdur" → "Durdur" → closed → "Siparişleri aç".
 *   r8-rezerv    Ajanda ve rezervasyon → Saat 19:30 → Masa 05 → Ayşe Yılmaz, 4 kişi, "Doğum günü" → "Kaydet".
 *   r9-rapor     Satış ve Raporlar (Bugün: the sentence, the cards, Kasa durumu) → "Kasa kapanışları" → "7 gün": yesterday's gün sonu.
 *   r10-personel Personel → Vardiyalar (Bugün).
 *
 *   npx tsx scripts/sosyal/youtube-mudur-kayit.ts            (needs `npm run build`; ~8 minutes)
 *
 * No pointer: every click goes through Recorder.tap (box saved, a still lead-in the edit cuts). Mola window 1280×800 (2×), guest
 * phone 390×844 (3×). Ports: café 3762, Mola Merkez 3796. Every process is stopped at the end.
 * Output: .local/sosyal/youtube/mudur/kayit/<klip>/ (meta.json) and kayit/bilgi.json (amounts, order numbers).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { DESKTOP, NO_HINTS, PASSWORD, PHONE, ROOT, Recorder, istanbul, kit, pause, smoothScroll, typeIn } from './kayit-ortak';

const BASE = join(ROOT, '.local', 'sosyal', 'youtube', 'mudur');
const OUT = join(BASE, 'kayit');
const run = join(BASE, `run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const k = kit({ run, kafePort: 3762, merkezPort: 3796, saat: istanbul(-1, 22, 10) });
const { as, order, advance, settleAll } = k;
mkdirSync(OUT, { recursive: true });
const info: Record<string, unknown> = {};
const ist = (ms: number) => new Date(ms).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

// ---------- On the Mola window ----------
const card = (page: Page, table: string) => page.locator('.table-card', { has: page.locator('h3', { hasText: new RegExp(`^${table}$`) }) }).first();
const dialog = (page: Page) => page.getByRole('dialog').last();
const nav = (page: Page, name: string) => page.locator('aside nav').getByRole('button', { name, exact: true });
const toast = (page: Page, text: RegExp) => page.getByText(text).first().waitFor({ timeout: 15000 });
const menuRow = (page: Page, name: string) => page.locator('.menu-row', { has: page.locator('h3', { hasText: new RegExp(`^${name}$`) }) }).first();
/** Replaces a field's text the way a person does: click, select all, type. */
async function retype(page: Page, rec: Recorder, name: string, field: Locator, text: string) {
  await rec.tap(page, name, field, { lead: 700, hold: 150 });
  await field.press('Control+a'); await field.pressSequentially(text, { delay: 110 }); await pause(page, 400);
}
async function top(page: Page) { await page.evaluate('scrollTo({ top: 0, behavior: "smooth" })'); await pause(page, 900); }

async function main() {
  await k.launch();
  const desk = k.deskBrowser;
  try {
    await k.startServers();
    await k.prepareMenu(desk, { waiterApproval: false, changeSeconds: 0 });
    await k.calm(desk, true);

    // ===== Yesterday evening (off camera): the floor settled, the kasa closed (count = expected), ₺500 left =====
    await settleAll();
    { const api = await k.ownerApi(desk);
      // The Müdür account, as the owner opens it in Personel → Çalışanlar.
      await k.post(api.req, '/api/staff/users', { username: 'mudur', name: 'Selin Koç', role: 'manager', password: PASSWORD });
      await api.close();
      const exp = await k.closeKasa({ count: e => e > 50000 ? e : 386500 });
      info.yesterdayCash = exp; console.log('Dün beklenen nakit:', Number(exp) / 100); }
    console.log('Dün kapandı:', ist(k.now()));

    // ===== This morning (off camera): the kasa opened, the morning's tables served and paid =====
    await k.setClock(istanbul(0, 8, 2));
    await k.openKasa();
    const morning: [string, number, [string, number][], 'cash' | 'card'][] = [
      ['Masa 02', 8 * 60 + 40, [['Türk Kahvesi', 2], ['Fırın Sütlaç', 1]], 'cash'],
      ['Masa 05', 9 * 60 + 25, [['San Sebastian', 2], ['Americano', 2]], 'cash'],
      ['Masa 07', 10 * 60 + 5, [['Caffè Latte', 2], ['Çikolatalı Brownie', 1]], 'card'],
      ['Masa 10', 11 * 60 + 20, [['Ev Yapımı Limonata', 3], ['Künefe', 1]], 'card'],
      ['Masa 12', 12 * 60 + 10, [['Ayran', 2], ['Kazandibi', 2]], 'cash'],
      ['Masa 15', 12 * 60 + 50, [['Demleme Çay', 3], ['Fıstıklı Baklava', 1]], 'card'],
    ];
    await k.serveDay(morning.map(([table, at, lines, method]) => ({ table, at, lines, method })));
    // The floor at lunch: served, ready, in the kitchen, new; Masa 08's order has one Limonata too many.
    await k.setClock(istanbul(0, 13, 30));
    await order('Masa 03', [['Caffè Latte', 1], ['San Sebastian', 1]]);
    await order('Masa 06', [['Türk Kahvesi', 2], ['Fıstıklı Baklava', 1]]);
    await advance(['preparing', 'ready', 'served']);
    await k.setClock(istanbul(0, 13, 38));
    await order('Masa 09', [['Americano', 2], ['Profiterol', 1]]);
    await advance(['preparing', 'ready'], 'Masa 09');
    await order('Masa 11', [['Ev Yapımı Limonata', 2], ['Künefe', 1]]);
    await advance(['preparing'], 'Masa 11');
    await k.setClock(istanbul(0, 13, 49));
    await order('Masa 14', [['Demleme Çay', 2], ['Ihlamur', 1]]);
    await order('Masa 08', [['Ev Yapımı Limonata', 2], ['Çikolatalı Brownie', 1]]);
    // The cashier's refund above her limit (₺150): one San Sebastian of Masa 05, "Geç geldi".
    await k.setClock(istanbul(0, 13, 55));
    { const c = await as('kasiyer');
      const rows = (await (await c.req.get(`${k.KAFE}/api/staff/refunds/payments`)).json() as { rows: { id: string; tableName: string }[] }).rows;
      const pay = rows.find(r => r.tableName === 'Masa 05')!;
      const d = await (await c.req.get(`${k.KAFE}/api/staff/refunds/payments/${pay.id}`)).json() as { items: { orderId: string; lineId: string; name: string; unit: number }[] };
      const it = d.items.find(i => i.name === 'San Sebastian')!;
      await k.post(c.req, '/api/staff/refunds/requests', { requestId: randomUUID(), paymentId: pay.id, amount: it.unit, method: 'cash', reasons: ['late'], note: 'Tatlı yarım saat sonra geldi', items: [{ orderId: it.orderId, lineId: it.lineId, quantity: 1 }] });
      await c.close();
      info.request = { table: 'Masa 05', amount: it.unit }; }

    // The cashier's own screen stays open on Masalar (the refund's note lands there).
    await k.setClock(istanbul(0, 14, 4));
    const cctx = await k.desktopContext(); await cctx.addInitScript(NO_HINTS);
    const cpage = await cctx.newPage();
    await k.login(cpage, 'kasiyer'); await pause(cpage, 1000);
    await cpage.mouse.click(900, 20); await pause(cpage, 500);

    // ===== The Müdür's screen =====
    const ctx = await k.desktopContext(); await ctx.addInitScript(NO_HINTS);
    const page = await ctx.newPage();
    // Signed in once (and out) off camera, so the recorded sign-in is the everyday one (no first-time notes).
    await k.login(page, 'mudur');
    await page.getByRole('button', { name: 'Çıkış yap' }).first().click();
    await page.getByLabel('Kullanıcı adı', { exact: true }).waitFor();
    await page.goto(`${k.KAFE}/`);
    await page.getByLabel('Kullanıcı adı', { exact: true }).waitFor(); await pause(page, 1200);
    info.signIn = ist(k.now());

    // ===== r1: sign in =====
    console.log('Kayıt: r1-giris');
    let rec = new Recorder(page, join(OUT, 'r1-giris'), DESKTOP);
    await rec.start(); await pause(page, 1600);
    await typeIn(page, rec, 'user', page.getByLabel('Kullanıcı adı', { exact: true }), 'mudur', { delay: 110 });
    await typeIn(page, rec, 'pass', page.getByLabel('Şifre', { exact: true }), PASSWORD, { delay: 60 });
    await rec.tap(page, 'open', page.getByRole('button', { name: 'Çalışma alanını aç' }), { hold: 300 });
    await page.locator('.floor-line.counter').first().waitFor({ timeout: 20000 });
    rec.mark('in'); await pause(page, 2200);
    await rec.look(page, 'daily', page.locator('aside nav'), 3400);
    await rec.look(page, 'account', page.locator('.user-row'), 2600);
    await rec.stop();
    // Off camera: a click on the header unlocks the sounds ("Ses kapalı" goes away), as on a working counter.
    await page.mouse.click(900, 20); await pause(page, 600);
    const sound = page.getByText(/Ses kapalı/).first();
    if (await sound.isVisible().catch(() => false)) { await sound.click(); await pause(page, 600); }

    // ===== r2: the day at a glance =====
    console.log('Kayıt: r2-ozet');
    rec = new Recorder(page, join(OUT, 'r2-ozet'), DESKTOP);
    await rec.start(); await pause(page, 1200);
    await rec.look(page, 'line', page.locator('.floor-line.counter').first(), 4200);
    await rec.look(page, 'chip', page.locator('.cash-chip').first(), 3200);
    await rec.tap(page, 'open', page.getByRole('button', { name: /^Açık/ }).first(), { hold: 1600 });
    await rec.look(page, 'tables', page.locator('.table-card').first(), 2400);
    await rec.stop();

    // ===== r3: cancelling an item with a reason =====
    console.log('Kayıt: r3-iptal');
    rec = new Recorder(page, join(OUT, 'r3-iptal'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'table', card(page, 'Masa 08'), { hold: 1400 });
    await rec.look(page, 'order', dialog(page).locator('.detail-order').first(), 2400);
    await rec.tap(page, 'cancel', dialog(page).locator('.order-cancel-open').first(), { lead: 1800, hold: 1400 });
    rec.mark('modal');
    await rec.tap(page, 'item', dialog(page).getByRole('button', { name: 'Ev Yapımı Limonata · bir daha iptal' }), { hold: 900 });
    await rec.tap(page, 'reason', dialog(page).locator('.reason-chips').getByRole('button', { name: 'Yanlış sipariş' }), { hold: 1200 });
    await rec.tap(page, 'save', dialog(page).getByRole('button', { name: /Seçilenleri iptal et/ }), { hold: 200 });
    await toast(page, /ürün iptal edildi/);
    rec.mark('done'); await pause(page, 2600);
    await rec.tap(page, 'again', card(page, 'Masa 08'), { hold: 1400 });
    await rec.look(page, 'cancelled', dialog(page).locator('.line-cancelled').first(), 2800);
    await page.keyboard.press('Escape'); await pause(page, 900);
    await rec.stop();

    // ===== r4: sold out =====
    console.log('Kayıt: r4-tukendi');
    rec = new Recorder(page, join(OUT, 'r4-tukendi'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'nav', nav(page, 'Menü yönetimi'), { hold: 1600 });
    rec.mark('menu');
    const search = page.getByPlaceholder('Ürün adı veya kodu');
    await typeIn(page, rec, 'search', search, 'Profiterol', { delay: 90 });
    await pause(page, 1000);
    const ss = menuRow(page, 'Profiterol');
    await rec.tap(page, 'soldout', ss.locator('label.availability'), { lead: 1800, hold: 400 });
    await page.waitForFunction(() => { const r = [...document.querySelectorAll('.menu-row')].find(e => e.querySelector('h3')?.textContent === 'Profiterol'); const i = r?.querySelector('label.availability input') as HTMLInputElement | null; return !!i && i.checked && !i.disabled; }, undefined, { timeout: 15000 });
    rec.mark('done'); await pause(page, 2600);
    await rec.stop();

    // ===== q4: the guest's menu =====
    console.log('Kayıt: q4-menu');
    { const api = await k.ownerApi(desk), token = (await k.state(api.req)).tables.find(t => t.name === 'Masa 04')!.token; await api.close();
      const pctx = await k.phoneContext(), pp = await pctx.newPage();
      await k.openMenu(pp, token);
      const prec = new Recorder(pp, join(OUT, 'q4-menu'), PHONE);
      await prec.start(); await pause(pp, 1200);
      const target = pp.locator('.product-card', { hasText: 'Profiterol' }).first();
      const y = await target.evaluate(e => e.getBoundingClientRect().top - 240);
      await smoothScroll(pp, Math.round(y), 1400); await pause(pp, 900);
      await prec.look(pp, 'card', target, 3600);
      await prec.stop();
      await pctx.close(); }

    // ===== r4-geri: back on the menu =====
    console.log('Kayıt: r4-geri');
    rec = new Recorder(page, join(OUT, 'r4-geri'), DESKTOP);
    await rec.start(); await pause(page, 1200);
    await rec.tap(page, 'back', ss.locator('label.availability'), { lead: 1400, hold: 400 });
    await page.waitForFunction(() => { const r = [...document.querySelectorAll('.menu-row')].find(e => e.querySelector('h3')?.textContent === 'Profiterol'); const i = r?.querySelector('label.availability input') as HTMLInputElement | null; return !!i && !i.checked && !i.disabled; }, undefined, { timeout: 15000 });
    rec.mark('done'); await pause(page, 2200);
    await rec.stop();

    // ===== r5: a new price =====
    console.log('Kayıt: r5-fiyat');
    rec = new Recorder(page, join(OUT, 'r5-fiyat'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await retype(page, rec, 'search', search, 'Latte');
    await pause(page, 900);
    const latte = menuRow(page, 'Caffè Latte');
    await rec.look(page, 'row', latte, 1800);
    await rec.tap(page, 'edit', latte.getByRole('button', { name: /Düzenle/ }), { hold: 1600 });
    rec.mark('editor');
    const price = dialog(page).getByLabel('Fiyat (TL)', { exact: true });
    await retype(page, rec, 'price', price, '150');
    await pause(page, 900);
    await rec.tap(page, 'save', dialog(page).getByRole('button', { name: 'Kaydet ve yayınla' }), { hold: 200 });
    await dialog(page).getByLabel('Fiyat (TL)', { exact: true }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    rec.mark('done'); await pause(page, 1200);
    await rec.look(page, 'saved', latte, 3000);
    await rec.stop();
    await search.fill(''); await pause(page, 500);

    // ===== r6: the cashier's refund request =====
    console.log('Kayıt: r6-iade');
    rec = new Recorder(page, join(OUT, 'r6-iade'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'nav', nav(page, 'Kasa ve giderler'), { hold: 1400 });
    await rec.tap(page, 'tab', page.getByRole('navigation', { name: 'Kasa ve giderler bölümleri', exact: true }).getByRole('button', { name: 'İadeler' }), { hold: 1600 });
    const req = page.locator('section.refund-requests');
    await req.waitFor({ timeout: 15000 });
    rec.mark('list'); await pause(page, 600);
    await rec.look(page, 'request', req.locator('.refund-request').first(), 4200);
    await rec.tap(page, 'do', req.getByRole('button', { name: 'İadeyi yap' }).first(), { hold: 1600 });
    await req.locator('.refund-form .refund-actions').first().waitFor({ timeout: 15000 });
    rec.mark('form');
    await req.locator('.refund-form').first().scrollIntoViewIfNeeded(); await pause(page, 600);
    await rec.look(page, 'form', req.locator('.refund-form').first(), 3600);
    await rec.tap(page, 'save', req.getByRole('button', { name: 'İadeyi kaydet' }), { hold: 1400 });
    await rec.tap(page, 'yes', req.getByRole('button', { name: 'Evet, iadeyi kaydet' }), { hold: 200 });
    await toast(page, /iade kaydedildi|İade kaydedildi/);
    rec.mark('done'); await pause(page, 2600);
    await rec.stop();

    // ===== k6: where it lands: the cashier's screen =====
    console.log('Kayıt: k6-kasa');
    { const note = cpage.locator('[data-testid="till-notice"]').first();
      await note.waitFor({ timeout: 20000 });
      await top(cpage); await pause(cpage, 600);
      const crec = new Recorder(cpage, join(OUT, 'k6-kasa'), DESKTOP);
      await crec.start(); await pause(cpage, 800);
      await crec.look(cpage, 'note', note, 4200);
      await crec.stop();
      info.tillNotice = await note.innerText(); }
    await cctx.close();

    // ===== r7: stopping QR orders =====
    console.log('Kayıt: r7-qr');
    await nav(page, 'Masalar').click(); await pause(page, 1500); await top(page);
    rec = new Recorder(page, join(OUT, 'r7-qr'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    const qr = page.locator('[data-testid="qr-ordering-card"]');
    await rec.tap(page, 'stop', qr.getByRole('button', { name: 'QR siparişlerini durdur' }), { lead: 2200, hold: 1400 });
    rec.mark('ask');
    await rec.look(page, 'question', dialog(page).locator('.qr-ordering-confirm p'), 3000);
    await rec.tap(page, 'confirm', dialog(page).getByRole('button', { name: 'Durdur', exact: true }), { hold: 200 });
    await page.locator('[data-testid="qr-ordering-card"][data-open="no"]').waitFor({ timeout: 15000 });
    rec.mark('closed'); await pause(page, 1200);
    await rec.look(page, 'card', qr, 3000);
    await rec.look(page, 'bar', page.locator('[data-testid="qr-ordering-bar"]').first(), 3000);
    await rec.tap(page, 'reopen', qr.getByRole('button', { name: 'Siparişleri aç' }), { lead: 1600, hold: 200 });
    await page.locator('[data-testid="qr-ordering-card"][data-open="yes"]').waitFor({ timeout: 15000 });
    rec.mark('open'); await pause(page, 2400);
    await rec.stop();

    // ===== r8: a reservation =====
    console.log('Kayıt: r8-rezerv');
    rec = new Recorder(page, join(OUT, 'r8-rezerv'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'nav', nav(page, 'Ajanda ve rezervasyon'), { hold: 1600 });
    rec.mark('plan');
    await retype(page, rec, 'time', page.locator('.resv-plan-time input'), '19:30');
    await page.keyboard.press('Tab'); await pause(page, 1200);
    await rec.tap(page, 'table', page.locator('.resv-plan button', { hasText: 'Masa 05' }).first(), { hold: 1400 });
    rec.mark('form');
    const f = dialog(page);
    await typeIn(page, rec, 'name', f.getByPlaceholder('Ör. Ahmet Yılmaz'), 'Ayşe Yılmaz', { delay: 80 });
    await retype(page, rec, 'people', f.getByLabel('Kişi sayısı'), '4');
    await typeIn(page, rec, 'note', f.getByPlaceholder('Ör. Doğum günü, pencere kenarı'), 'Doğum günü', { delay: 80 });
    await pause(page, 600);
    await rec.tap(page, 'save', f.getByRole('button', { name: 'Kaydet', exact: true }), { hold: 200 });
    await f.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
    rec.mark('done'); await pause(page, 1200);
    const day = page.getByRole('heading', { name: 'Günün rezervasyonları' });
    const dy = await day.evaluate(e => e.getBoundingClientRect().top - 260);
    await smoothScroll(page, Math.round(dy), 1100); await pause(page, 700);
    await rec.look(page, 'list', day.locator('xpath=ancestor::section[1]'), 3600);
    await rec.stop();

    // ===== r9: reports and closings =====
    console.log('Kayıt: r9-rapor');
    await top(page);
    rec = new Recorder(page, join(OUT, 'r9-rapor'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'nav', nav(page, 'Satış ve Raporlar'), { hold: 2000 });
    rec.mark('reports');
    const sentence = page.locator('.simple-sentence').first();
    await sentence.waitFor({ timeout: 15000 }); await pause(page, 600);
    await rec.look(page, 'sentence', sentence, 4000);
    await rec.look(page, 'grid', page.locator('.simple-grid').first(), 3400);
    const kasa = page.locator('.simple-kasa').first();
    const ky = await kasa.evaluate(e => e.getBoundingClientRect().top - 330);
    await smoothScroll(page, Math.round(ky), 1000); await pause(page, 600);
    await rec.look(page, 'kasa', kasa, 2600);
    await rec.tap(page, 'closings', kasa.getByRole('button', { name: /Kasa kapanışları/ }), { hold: 1600 });
    await rec.tap(page, 'week', page.getByRole('button', { name: '7 gün', exact: true }).first(), { hold: 1800 });
    rec.mark('list');
    await rec.look(page, 'note', page.getByText('Beklenen nakit ve fark yalnız işletme sahibinde görünür.').first(), 3200);
    await rec.stop();

    // ===== r10: who worked today =====
    console.log('Kayıt: r10-personel');
    rec = new Recorder(page, join(OUT, 'r10-personel'), DESKTOP);
    await rec.start(); await pause(page, 1000);
    await rec.tap(page, 'nav', nav(page, 'Personel'), { hold: 1800 });
    rec.mark('staff');
    const table = page.getByText('Personel verimliliği').first();
    const ty = await table.evaluate(e => e.getBoundingClientRect().top - 120);
    await smoothScroll(page, Math.round(ty), 1100); await pause(page, 600);
    await rec.look(page, 'list', table, 4200);
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
