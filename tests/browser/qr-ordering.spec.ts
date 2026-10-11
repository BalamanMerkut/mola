import { test, expect, request as playwrightRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { adminLogin, ADMIN_API, detailTab, ensureSetup, openBusiness, openView, openYonetim } from './helpers';

/*
 * QR siparişleri açık mı (8 Ekim; server/qr-ordering.ts, src/QrOrdering.tsx) and the menu copy at Mola Merkez
 * (server/menu-mirror.ts, server/merkez/menu-mirror.ts). The menu is always there; ordering from the phone is open only while
 * a staff screen is connected, not after gün sonu (until "Aç"), not while stopped by hand. With the café computer away the
 * guest browses Merkez's copy. 10 Ekim: the state is a card at the top of the sidebar (no top-bar chip any more), a slim amber
 * strip on Masalar while closed, and one line under the top bar on phones. Screens (KAFE_EKRAN=docs/ekran/kafe):
 * kafe/qr-durum-kart-acik.png, kafe/qr-durum-kart-kapali.png, kafe/qr-durum-telefon.png, kafe/qr-siparis-durdur.png,
 * misafir/siparis-kapali.png, misafir/gizlilik.png, misafir/menu-kopyadan.png.
 */
const PASSWORD = 'MolaDemo!2026';
const KAFE = `http://127.0.0.1:${process.env.E2E_PORT ?? '3100'}`;
const CLOSED = 'Şu an sipariş almıyoruz, lütfen garsonunuza sorun.', OFFLINE = 'Şu an sipariş alınamıyor, lütfen garsonunuza sorun.';
async function shot(page: Page, folder: 'kafe' | 'misafir', file: string, path: string, options: { fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } } = {}) {
  await page.screenshot({ path, ...options });
  const kafe = process.env.KAFE_EKRAN;
  if (kafe) { const dir = folder === 'kafe' ? kafe : join(dirname(kafe), 'misafir'); mkdirSync(dir, { recursive: true }); await page.screenshot({ path: join(dir, file), ...options }); }
}
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function staffPage(browser: Browser, username: string, viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport }), page = await context.newPage();
  expect((await page.request.post('/api/login', { data: { username, password: PASSWORD } })).ok()).toBe(true);
  return page;
}
const card = (page: Page) => page.getByTestId('qr-ordering-card'), strip = (page: Page) => page.getByTestId('qr-ordering-bar');
/** The top of the sidebar (the business card, the QR card) with the start of the page beside it. */
async function sidebarTop(page: Page) {
  const box = await card(page).boundingBox();
  return box ? { clip: { x: 0, y: 0, width: 760, height: Math.ceil(box.y + box.height + 28) } } : {};
}
async function guestMenu(browser: Browser, token: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage();
  await page.goto(`/m/${token}`);
  await expect(page.getByRole('button', { name: /Demleme Çay/ })).toBeVisible({ timeout: 15_000 });
  return page;
}
async function freeTable(request: APIRequestContext) {
  const state = await (await request.get('/api/staff/state')).json();
  return state.tables.find((t: any) => !t.account && !t.needsCleaning);
}

test.beforeAll(async ({ request }) => {
  await request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(request);
  expect((await request.post('/api/staff/settings', { data: { commissionBps: null, changeSeconds: 0, waiterApproval: false } })).ok()).toBe(true);
});

test('stop with confirmation, the guest\'s words, the 30-minute reminder; gün sonu pauses and "Aç" reopens; Mola Yönetim shows it', async ({ browser }, info) => {
  test.setTimeout(150_000);
  const cashier = await staffPage(browser, 'kasiyer');
  // The cash day open (the opening card would sit over the floor).
  await cashier.request.post('/api/staff/cash/open', { data: { requestId: `qr-open-${Date.now()}`, amount: 50000 } });
  await cashier.clock.install();
  await cashier.goto('/');
  // Open: a calm green card at the top of the sidebar, right under the business card; no strip on Masalar, no top-bar chip.
  await expect(card(cashier)).toHaveAttribute('data-open', 'yes');
  await expect(card(cashier)).toContainText('QR siparişleri açık');
  await expect(card(cashier)).toContainText('Müşteriler telefondan sipariş verebilir');
  expect(await card(cashier).evaluate(el => el.parentElement?.classList.contains('sidebar') && el.previousElementSibling?.classList.contains('business-pill'))).toBe(true);
  await expect(strip(cashier)).toHaveCount(0);
  await expect(cashier.locator('header.topbar').getByText(/QR/)).toHaveCount(0);
  await expect(cashier.getByTestId('qr-ordering-chip')).toHaveCount(0);
  await shot(cashier, 'kafe', 'qr-durum-kart-acik.png', info.outputPath('qr-durum-kart-acik.png'), await sidebarTop(cashier));
  // "Durdur" asks first, in the owner's words.
  await card(cashier).getByTestId('qr-ordering-stop').click();
  const confirm = cashier.getByRole('dialog', { name: 'QR siparişlerini durdur' });
  await expect(confirm).toContainText('Emin misiniz? Müşteriler telefondan sipariş veremez. Menü görünmeye devam eder, siparişleri garsonlar alır.');
  await shot(cashier, 'kafe', 'qr-siparis-durdur.png', info.outputPath('qr-siparis-durdur.png'));
  await confirm.getByRole('button', { name: 'Vazgeç' }).click();
  await expect(card(cashier)).toHaveAttribute('data-open', 'yes');
  await card(cashier).getByRole('button', { name: 'QR siparişlerini durdur' }).click();
  await cashier.getByRole('dialog', { name: 'QR siparişlerini durdur' }).getByRole('button', { name: 'Durdur' }).click();
  // Closed: the amber card with the reason and "Siparişleri aç"; Masalar gets the slim amber strip with "Aç".
  await expect(card(cashier)).toHaveAttribute('data-reason', 'stopped');
  await expect(card(cashier)).toContainText('QR siparişleri kapalı');
  await expect(card(cashier)).toContainText(/Elle durduruldu/);
  await expect(cashier.getByTestId('qr-ordering-open')).toHaveText('Siparişleri aç');
  await expect(strip(cashier)).toContainText('QR siparişleri kapalı: müşteriler masadan sipariş veremiyor');
  await expect(strip(cashier).getByRole('button', { name: 'Aç', exact: true })).toBeVisible();
  // Only on Masalar: Kasa has the card alone.
  await openView(cashier, 'Kasa');
  await expect(strip(cashier)).toHaveCount(0);
  await expect(card(cashier)).toHaveAttribute('data-open', 'no');
  await openView(cashier, 'Masalar');
  await expect(strip(cashier)).toBeVisible();

  // The guest: the menu stays, the basket waits, sending says why; Garson çağır still works (a staff screen is connected).
  const table = await freeTable(cashier.request);
  const guest = await guestMenu(browser, table.token);
  await expect(guest.getByTestId('ordering-closed')).toContainText(CLOSED);
  await expect(guest.getByRole('button', { name: 'Garson çağır' })).toBeEnabled();
  expect(await fits(guest)).toBe(true);
  await shot(guest, 'misafir', 'siparis-kapali.png', info.outputPath('siparis-kapali.png'));
  await guest.getByRole('button', { name: /Demleme Çay/ }).click();
  await guest.getByRole('button', { name: /Sepete ekle/ }).click();
  await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await expect(guest.getByRole('button', { name: 'Siparişi gönder', exact: true })).toBeDisabled();
  await expect(guest.locator('.send-blocked-reason')).toHaveText(CLOSED);
  await guest.screenshot({ path: info.outputPath('sepet-kapali.png') });
  await guest.keyboard.press('Escape');

  // The waiter's phone: closed, the line under the top bar with the reason (no "Aç" for a waiter, no sidebar card).
  const waiter = await staffPage(browser, 'garson', { width: 390, height: 844 });
  await waiter.goto('/');
  await expect(strip(waiter)).toContainText('QR siparişleri kapalı · elle durduruldu');
  await expect(strip(waiter).getByRole('button')).toHaveCount(0);
  await expect(card(waiter)).toHaveCount(0);
  expect(await fits(waiter)).toBe(true);
  // Masalar on the waiter's phone: a call and a waiting approval stay small, so the tables are on the first screen.
  await guest.getByRole('button', { name: 'Garson çağır' }).click();
  await waiter.getByRole('navigation', { name: 'Alt menü' }).getByRole('button', { name: 'Masalar' }).click();
  await expect(waiter.locator('.service-call-bar.compact .service-call-chip')).toHaveCount(1, { timeout: 10_000 });
  const firstTable = await waiter.locator('.table-grid').first().boundingBox();
  expect(firstTable && firstTable.y < 844, 'the table grid starts on the first screen').toBe(true);
  // More calls than fit: the call strip scrolls inside itself, the page never scrolls sideways (its hidden "Tamam" labels too).
  const others = (await (await waiter.request.get('/api/staff/state')).json()).tables.filter((t: any) => t.token !== table.token).slice(0, 3);
  for (const other of others) { const g = await guestMenu(browser, other.token); await g.getByRole('button', { name: 'Garson çağır' }).click(); await g.context().close(); }
  await expect(waiter.locator('.service-call-bar.compact .service-call-chip')).toHaveCount(4, { timeout: 10_000 });
  expect(await fits(waiter)).toBe(true);
  await waiter.screenshot({ path: info.outputPath('garson-telefon-qr.png') });
  // Answered, so the next tests start without waiting calls.
  for (const call of (await (await waiter.request.get('/api/staff/state')).json()).serviceCalls ?? []) expect((await waiter.request.post('/api/staff/calls/resolve', { data: { callId: call.id } })).ok()).toBe(true);

  // Mola Yönetim → the business → Özet: the café told Merkez at once over its tunnel.
  const vendor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const yonetim = await vendor.newPage();
  await openYonetim(yonetim);
  const name = (await (await cashier.request.get('/api/staff/state')).json()).name;
  const detail = await openBusiness(yonetim, name);
  await detailTab(detail, 'Özet').click();
  const fact = detail.locator('.detail-facts > div').filter({ has: yonetim.locator('dt', { hasText: 'QR siparişleri' }) });
  await expect(fact).toContainText('Kapalı', { timeout: 20_000 }); await expect(fact).toContainText('elle durduruldu');

  // 30 minutes stopped: a reminder on every staff screen, not only Masalar ("Aç" for the cashier); one tap reopens.
  await openView(cashier, 'Kasa');
  await cashier.clock.fastForward('31:00');
  const reminder = cashier.getByTestId('qr-ordering-reminder');
  await expect(reminder).toContainText(/QR siparişleri 3\d dakikadır kapalı: müşteriler masadan sipariş veremiyor/, { timeout: 20_000 });
  await expect(card(cashier)).toContainText(/Elle durduruldu.* · 3\d dakikadır/);
  await reminder.getByRole('button', { name: 'Aç', exact: true }).click();
  await expect(card(cashier)).toHaveAttribute('data-open', 'yes');
  await expect(cashier.getByTestId('qr-ordering-reminder')).toHaveCount(0);
  await openView(cashier, 'Masalar');
  await expect(guest.getByTestId('ordering-closed')).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(async () => (await (await vendor.request.get(`${ADMIN_API}/state`)).json()).businesses.find((b: any) => b.name === name).menu?.ordering?.open, { timeout: 20_000 }).toBe(true);

  // Gün sonu: QR siparişleri pause; the card says why and "Siparişleri aç" reopens with one tap.
  const counted = await (await cashier.request.post('/api/staff/cash/count', { data: { requestId: `qr-count-${Date.now()}`, mode: 'final', counted: 50000 } })).json();
  expect((await cashier.request.post('/api/staff/cash/finish', { data: { id: counted.id, left: 50000, note: 'QR denemesi' } })).ok()).toBe(true);
  await cashier.reload();
  await expect(card(cashier)).toHaveAttribute('data-reason', 'closing', { timeout: 10_000 });
  await expect(card(cashier)).toContainText('QR siparişleri kapalı');
  await expect(card(cashier)).toContainText('Gün sonu yapıldı · müşteriler telefondan sipariş veremiyor');
  await expect(strip(cashier)).toContainText('QR siparişleri kapalı: müşteriler masadan sipariş veremiyor');
  await expect(guest.getByTestId('ordering-closed')).toContainText(CLOSED, { timeout: 10_000 });
  await shot(cashier, 'kafe', 'qr-durum-kart-kapali.png', info.outputPath('qr-durum-kart-kapali.png'), await sidebarTop(cashier));
  // The cashier's phone: no sidebar, the same state in one slim line under the top bar, "Aç" included.
  const cashierPhone = await staffPage(browser, 'kasiyer', { width: 390, height: 844 });
  await cashierPhone.goto('/');
  await expect(strip(cashierPhone)).toContainText('QR siparişleri kapalı · gün sonu yapıldı');
  await expect(strip(cashierPhone).getByRole('button', { name: 'Aç', exact: true })).toBeVisible();
  await expect(card(cashierPhone)).toHaveCount(0);
  const top = await cashierPhone.locator('header.topbar').boundingBox(), line = await strip(cashierPhone).boundingBox();
  expect(top && line && line.y - (top.y + top.height) < 24 && line.height <= 48, 'a slim line right under the top bar').toBe(true);
  expect(await fits(cashierPhone)).toBe(true);
  await shot(cashierPhone, 'kafe', 'qr-durum-telefon.png', info.outputPath('qr-durum-telefon.png'), { clip: { x: 0, y: 0, width: 390, height: 300 } });
  await cashier.getByTestId('qr-ordering-open').click();
  await expect(card(cashier)).toHaveAttribute('data-open', 'yes');
  await expect(strip(cashier)).toHaveCount(0);
  await expect(guest.getByTestId('ordering-closed')).toHaveCount(0, { timeout: 10_000 });
  // Open again: the phone line turns green with "Durdur" (it asks first there too).
  await expect(strip(cashierPhone)).toHaveAttribute('data-open', 'yes', { timeout: 10_000 });
  await expect(strip(cashierPhone)).toContainText('QR siparişleri açık');
  await strip(cashierPhone).getByRole('button', { name: 'QR siparişlerini durdur' }).click();
  await expect(cashierPhone.getByRole('dialog', { name: 'QR siparişlerini durdur' })).toContainText('Emin misiniz?');
  await cashierPhone.getByRole('dialog', { name: 'QR siparişlerini durdur' }).getByRole('button', { name: 'Vazgeç' }).click();
  expect(await fits(cashierPhone)).toBe(true);
  await cashierPhone.context().close();
  await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
  await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
  await expect(guest.getByRole('dialog', { name: 'Siparişiniz alındı' })).toBeVisible();
  for (const p of [cashier, guest, waiter]) await p.context().close();
  await vendor.close();
});

test('no staff screen connected: ordering and the waiter call wait; a screen signing in opens them; Mola Yönetim says why', async ({ browser, request }) => {
  test.setTimeout(120_000);
  expect((await request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
  const table = await freeTable(request), name = (await (await request.get('/api/staff/state')).json()).name;
  // This server starts with the rule off (the other suites order without a staff screen); here it is on, with a short window.
  expect((await request.post('/api/test/qr-staff', { data: { on: true, windowMs: 2500 } })).ok()).toBe(true);
  try {
    await new Promise(r => setTimeout(r, 3500));
    const guest = await guestMenu(browser, table.token);
    await expect(guest.getByTestId('ordering-closed')).toContainText(CLOSED);
    await expect(guest.getByRole('button', { name: 'Garson çağır' })).toBeDisabled();
    const vendor = await playwrightRequest.newContext();
    await adminLogin(vendor);
    await expect.poll(async () => (await (await vendor.get(`${ADMIN_API}/state`)).json()).businesses.find((b: any) => b.name === name).menu?.ordering?.reason, { timeout: 20_000 }).toBe('staff');
    // The kitchen tablet comes on: ordering opens by itself.
    const kitchen = await staffPage(browser, 'mutfak');
    await kitchen.goto('/');
    await expect(guest.getByTestId('ordering-closed')).toHaveCount(0, { timeout: 10_000 });
    await expect(guest.getByRole('button', { name: 'Garson çağır' })).toBeEnabled();
    await kitchen.context().close(); await guest.context().close(); await vendor.dispose();
  } finally { await request.post('/api/test/qr-staff', { data: { on: false } }); }
});

test('the café computer away: the guest browses Mola Merkez\'s copy, ordering closed; back on, the basket goes; sold out a moment ago; Gizlilik', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  expect((await request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } })).ok()).toBe(true);
  await expect.poll(async () => (await (await request.get('/api/staff/network')).json()).public?.connected ?? false, { timeout: 30_000 }).toBe(true);
  const base: string = (await (await request.get('/api/staff/network')).json()).public.base;
  const table = await freeTable(request), url = `${base}/${table.token}`;
  // The copy reaches Merkez a moment after the café connects (and after every change).
  const vendor = await playwrightRequest.newContext(); await adminLogin(vendor);
  const name = (await (await request.get('/api/staff/state')).json()).name;
  await expect.poll(async () => (await (await vendor.get(`${ADMIN_API}/state`)).json()).businesses.find((b: any) => b.name === name).menu?.mirror?.products ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await phone.route(`${KAFE}/**`, route => route.abort());
  try {
    expect((await request.post('/api/test/tunnel', { data: { on: false } })).ok()).toBe(true);
    await expect.poll(async () => (await vendor.get(`${ADMIN_API}/state`).then(r => r.json())).businesses.find((b: any) => b.name === name).menu?.online, { timeout: 15_000 }).toBe(false);
    const guest = await phone.newPage();
    await guest.goto(url);
    await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeVisible({ timeout: 20_000 });
    await expect(guest.getByTestId('ordering-offline')).toContainText(OFFLINE);
    await expect(guest.getByRole('button', { name: 'Garson çağır' })).toBeDisabled();
    expect(await fits(guest)).toBe(true);
    await shot(guest, 'misafir', 'menu-kopyadan.png', info.outputPath('menu-kopyadan.png'));
    await guest.getByRole('button', { name: /Demleme Çay/ }).click();
    await guest.getByRole('button', { name: /Sepete ekle/ }).click();
    // Back on: the page starts a real session by itself; the basket typed on the copy is still there and goes to the café.
    expect((await request.post('/api/test/tunnel', { data: { on: true } })).ok()).toBe(true);
    await expect(guest.getByTestId('ordering-offline')).toHaveCount(0, { timeout: 30_000 });
    await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
    const send = guest.getByRole('button', { name: 'Siparişi gönder', exact: true });
    await expect(send).toBeEnabled();
    // Sold out a moment ago, before this phone heard of it: the café refuses plainly, the basket stays.
    await guest.route('**/api/guest/state', route => route.fulfill({ status: 204 }));
    const product = (await (await request.get('/api/staff/state')).json()).products.find((p: any) => p.id === 'tea');
    const { discounts: _d, firstPublishedAt: _f, ...fields } = product;
    expect((await request.post('/api/staff/products', { data: { id: 'tea', product: { ...fields, soldOut: true } } })).ok()).toBe(true);
    await send.click();
    await expect(guest.getByText(/Bu ürün az önce tükendi: Demleme Çay/).first()).toBeVisible({ timeout: 10_000 });
    await guest.unroute('**/api/guest/state');
    await expect(guest.locator('.cart-line-flag').filter({ hasText: 'Tükendi' })).toBeVisible({ timeout: 10_000 });
    expect((await request.post('/api/staff/products', { data: { id: 'tea', product: { ...fields, soldOut: false } } })).ok()).toBe(true);
    await guest.keyboard.press('Escape');
    // "Gizlilik" at the foot of the menu: what this menu processes (TASLAK), and back.
    await guest.getByRole('button', { name: 'Gizlilik', exact: true }).click();
    const privacy = guest.getByTestId('guest-privacy');
    await expect(privacy).toContainText('TASLAK');
    await expect(privacy).toContainText('mola_browser');
    await expect(privacy).toContainText(name);
    expect(await fits(guest)).toBe(true);
    await shot(guest, 'misafir', 'gizlilik.png', info.outputPath('gizlilik.png'));
    await privacy.getByRole('button', { name: 'Menüye dön' }).first().click();
    await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeVisible();
  } finally { await request.post('/api/test/tunnel', { data: { on: true } }); await phone.close(); await vendor.dispose(); }
});
