import { test, expect, request as playwrightRequest, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ADMIN_API, adminLogin, detailTab, ensureSetup, MERKEZ, openBusiness, openSettings, openYonetim } from './helpers';

/*
 * İnternetten menü (server/guest-tunnel.ts, server/merkez/guest-tunnel.ts): the table QR holds Mola Merkez's public address
 * (/q/<kod>/<masa kodu>) once the café's tunnel is ready. A guest on mobile data (here: a browser that cannot reach the café
 * computer at all) opens it, browses, orders, calls the waiter and asks for the bill; the order is in the café's kitchen; the
 * staff closes the bill and the guest sees "Hesabınız kapandı" and the review/follow card. Suspending the business in Mola
 * Yönetim closes the public menu; the café computer off shows "Menü şu anda açılamıyor"; staff paths are refused there.
 * The menu runs on its own name (MERKEZ_MENU_ORIGIN: menu.localhost here, menu.molayazilim.com.tr on the VDS): its cookie is
 * there only, an old Merkez-address QR is a 308 to it, and Mola Yönetim is not reachable on it.
 * Screens (KAFE_EKRAN=docs/ekran/kafe): kafe/masa-qr-internet.png, misafir/internetten-menu.png, misafir/menu-acilamiyor.png.
 */
const PASSWORD = 'MolaDemo!2026';
const KAFE = `http://127.0.0.1:${process.env.E2E_PORT ?? '3100'}`;
// The guest menu's own name (MERKEZ_MENU_ORIGIN in scripts/test-server.mjs; menu.molayazilim.com.tr on the VDS): Mola Yönetim
// stays on MERKEZ (127.0.0.1), the menu on menu.localhost (the browser resolves *.localhost to this computer).
const MENU = `http://menu.localhost:${process.env.E2E_MERKEZ_PORT ?? '3190'}`;
async function shot(page: Page, folder: 'kafe' | 'misafir', file: string, path: string, fullPage = false) {
  await page.screenshot({ path, fullPage });
  const kafe = process.env.KAFE_EKRAN;
  if (kafe) { const dir = folder === 'kafe' ? kafe : join(dirname(kafe), 'misafir'); mkdirSync(dir, { recursive: true }); await page.screenshot({ path: join(dir, file), fullPage }); }
}
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('İnternetten menü: a guest off the café network orders through Mola Merkez; suspended and offline pages; staff paths refused', async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await page.request.post('/api/staff/heartbeat', { data: {} });
  expect((await page.request.post('/api/staff/settings', { data: { commissionBps: null, changeSeconds: 0, waiterApproval: false } })).ok()).toBe(true);
  let state = await (await page.request.get('/api/staff/state')).json();
  expect((await page.request.post('/api/staff/social-links', { data: { requestId: 'internet-social', version: state.businessRevision, links: { instagram: '@molacoffee', review: 'https://g.page/r/mola-internet/review' } } })).ok()).toBe(true);
  // The public address is there once the café has its menu code and its tunnel is open (a few heartbeats).
  await expect.poll(async () => (await (await page.request.get('/api/staff/network')).json()).public?.connected ?? false, { timeout: 30_000 }).toBe(true);
  const network = await (await page.request.get('/api/staff/network')).json();
  const base: string = network.public.base;
  expect(base).toMatch(new RegExp(`^${MENU.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/q/[A-Za-z0-9]{10}$`));
  state = await (await page.request.get('/api/staff/state')).json();
  const table = state.tables.find((t: any) => !t.account && !t.needsCleaning), url = `${base}/${table.token}`;

  // Ayarlar → Masalar ve QR: the codes hold the internet address, "Bağlı"; the printed set records it.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await openSettings(page, 'Masalar ve QR');
  const card = page.locator('.qr-codes-card');
  await expect(card.locator('.qr-internet-note')).toContainText('QR kodları internet adresini taşır');
  await expect(card.locator('.qr-internet-state')).toContainText('Bağlı');
  await expect(card.locator('.qr-internet-note code')).toContainText(`${base.replace(/^https?:\/\//, '')}/…`);
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await shot(page, 'kafe', 'masa-qr-internet.png', info.outputPath('masa-qr-internet.png'));
  await page.setViewportSize({ width: 360, height: 780 });
  expect(await fits(page), 'Masalar ve QR 360px').toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  // Printing is its own sub-tab; it names the address the new codes carry in one line.
  await openSettings(page, 'QR kodlarını yazdır');
  await expect(card.locator('.qr-print-address')).toContainText('İnternet adresi: her ağdan açılır');
  await card.getByRole('button', { name: '6 QR', exact: true }).click();
  await card.getByRole('button', { name: 'Yazdır', exact: true }).click();
  await expect(page.getByTestId('qr-print-sheet').locator('.qr-cell')).toHaveCount(state.tables.length);
  await expect.poll(() => page.evaluate(() => (window as any).__printed)).toBe(1);
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await expect.poll(async () => (await (await page.request.get('/api/staff/network')).json()).printed?.origin).toBe(base);
  // The table window: the same public address in the QR, in "Müşteri menüsünü aç" and under the code.
  await page.goto('/');
  await page.locator('.table-card').filter({ has: page.getByRole('heading', { name: table.name, exact: true }) }).click();
  await page.getByRole('dialog', { name: table.name }).getByRole('button', { name: 'QR menüyü aç' }).click();
  const qrWindow = page.getByRole('dialog', { name: `${table.name} · QR menü` });
  await expect(qrWindow.getByRole('link', { name: 'Müşteri menüsünü aç' })).toHaveAttribute('href', url);
  await expect(qrWindow.locator('.qr-address')).toHaveText(url);
  await expect(qrWindow).toContainText('Misafir kendi mobil verisiyle ya da herhangi bir Wi-Fi\'den açar.');
  await qrWindow.getByRole('button', { name: 'Kapat', exact: true }).click();

  // The guest's phone on mobile data: it cannot reach the café computer at all, only Mola Merkez.
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const toCafe: string[] = [];
  await guestContext.route(`${KAFE}/**`, route => { toCafe.push(route.request().url()); return route.abort(); });
  await guestContext.route('http://localhost:*/**', route => { toCafe.push(route.request().url()); return route.abort(); });
  const vendor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const guest = await guestContext.newPage();
    const errors: string[] = []; guest.on('pageerror', e => errors.push(e.message));
    await guest.goto(url);
    await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeEnabled({ timeout: 20_000 });
    await expect(guest).toHaveTitle(new RegExp(`${state.name}`));
    expect(await fits(guest), 'guest menu 390px').toBe(true);
    await guest.waitForTimeout(300);
    await shot(guest, 'misafir', 'internetten-menu.png', info.outputPath('internetten-menu.png'));
    // Order → the café's kitchen.
    await guest.getByRole('button', { name: /Demleme Çay/ }).click();
    await guest.getByRole('button', { name: /Sepete ekle/ }).click();
    await guest.getByRole('button', { name: /Sepet(imi|i) görüntüle/ }).click();
    await guest.getByRole('button', { name: 'Siparişi gönder', exact: true }).click();
    const sent = guest.getByRole('dialog', { name: 'Siparişiniz alındı' });
    await expect(sent).toBeVisible();
    await sent.getByRole('button', { name: 'Tamam', exact: true }).click();
    const kitchen = await playwrightRequest.newContext({ baseURL: KAFE });
    try {
      expect((await kitchen.post('/api/login', { data: { username: 'mutfak', password: PASSWORD } })).ok()).toBe(true);
      await expect.poll(async () => ((await (await kitchen.get('/api/staff/state')).json()).orders ?? []).some((o: any) => o.tableName === table.name && o.source === 'qr' && ['new', 'preparing'].includes(o.status)), { timeout: 10_000 }).toBe(true);
    } finally { await kitchen.dispose(); }
    // The waiter and the bill.
    await guest.getByRole('button', { name: 'Garson çağır' }).click();
    await expect(guest.getByRole('button', { name: 'Garson çağrıldı' })).toBeDisabled();
    await guest.getByRole('button', { name: 'Hesabı iste' }).click();
    await guest.getByRole('group', { name: 'Nasıl ödeyeceksiniz?' }).getByRole('button', { name: 'Kart' }).click();
    await expect(guest.getByRole('button', { name: 'Hesap istendi' })).toBeDisabled();
    await expect.poll(async () => ((await (await page.request.get('/api/staff/state')).json()).serviceCalls ?? []).filter((c: any) => c.tableId === table.id).length).toBeGreaterThanOrEqual(2);
    // The staff closes the bill on the café: "Hesabınız kapandı" and the review/follow card on the guest's phone.
    const account = (await (await page.request.get('/api/staff/state')).json()).tables.find((x: any) => x.id === table.id).account;
    expect((await page.request.post('/api/staff/payments', { data: { requestId: 'internet-pay', accountId: account.id, version: account.version, amount: account.balance, tendered: account.balance, method: 'card' } })).ok()).toBe(true);
    const closed = guest.getByRole('status', { name: 'Hesabınız kapandı' });
    await expect(closed.getByRole('heading', { name: 'Hesabınız kapandı' })).toBeVisible({ timeout: 15_000 });
    const prompt = guest.locator('.review-prompt');
    await expect(prompt.getByRole('heading', { name: 'Bizi değerlendirin ve takip edin' })).toBeVisible({ timeout: 10_000 });
    await expect(prompt.getByRole('link', { name: 'Google’da değerlendirin' })).toHaveAttribute('href', 'https://g.page/r/mola-internet/review');
    await expect(prompt.getByRole('link', { name: 'Instagram’da takip edin' })).toBeVisible();
    // Everything came through Mola Merkez: nothing was asked of the café computer directly.
    expect(toCafe).toEqual([]);
    expect(errors).toEqual([]);
    // The guest cookie lives under this business's own prefix, on the menu's own name only (host-only, never Mola Yönetim's).
    const cookies = await guestContext.cookies();
    const guestCookie = cookies.find(c => c.name === 'mola_browser');
    expect(guestCookie?.path).toBe(`${new URL(base).pathname}/`);
    expect(guestCookie?.domain).toBe('menu.localhost');
    expect((await guestContext.cookies(MERKEZ)).length).toBe(0);
    // A QR printed with Mola Merkez's own address (before the menu had its own name) still opens: 308 to the menu name.
    const old = await guestContext.newPage();
    const moved = await old.goto(`${MERKEZ}${new URL(base).pathname}/${table.token}`);
    expect(old.url()).toBe(url); expect(moved?.status()).toBe(200);
    await old.close();
    // On the menu's name there is nothing but the menu: Mola Yönetim, its API and the short links are not there.
    for (const path of ['/', '/merkez.html', '/api/merkez/admin/state', '/api/merkez/v1/health', '/s/AAAAAAAA/instagram']) expect((await guest.request.get(`${MENU}${path}`)).status(), `menu ${path}`).toBe(404);

    // Staff, owner, desktop and install paths through the public address: refused (404) at Mola Merkez.
    for (const path of ['/api/staff/state', '/api/staff/reports/overview', '/api/staff/users', '/api/health', '/api/desktop/status', '/uygulama', '/api/mobile-app', '/api/test/tunnel', '/index.html']) {
      const r = await guest.request.get(`${base}${path}`);
      expect(r.status(), path).toBe(404);
    }
    expect((await guest.request.post(`${base}/api/login`, { data: { username: 'isletme', password: PASSWORD } })).status()).toBe(404);
    expect((await guest.request.post(`${base}/api/guest/orders`, { data: {}, headers: { Origin: 'https://baska-site.example' } })).status()).toBe(403);

    // Mola Yönetim → Askıya al: the public menu closes at once (Merkez decides, the café is not asked); "Hizmeti aç" reopens it.
    const yonetim = await vendor.newPage();
    await openYonetim(yonetim);
    const detail = await openBusiness(yonetim, state.name);
    await detailTab(detail, 'Lisans').click();
    await detail.getByRole('button', { name: 'Askıya al', exact: true }).click(); await detail.getByLabel(/Askıya alma nedeni/).fill('İnternetten menü denemesi'); await detail.locator('.suspend-form').getByRole('button', { name: 'Askıya al' }).click();
    await expect(detail.getByRole('button', { name: 'Hizmeti aç', exact: true })).toBeVisible();
    const scan = await guestContext.newPage();
    await scan.goto(url);
    await expect(scan.getByRole('heading', { name: 'Bu işletmenin dijital menüsü şu anda kullanılamıyor.' })).toBeVisible();
    await expect(scan.getByText('This business’s digital menu is currently unavailable.')).toBeVisible();
    expect(await fits(scan), 'unavailable page 360px').toBe(true);
    await scan.screenshot({ path: info.outputPath('menu-askida.png') });
    await detail.getByRole('button', { name: 'Hizmeti aç', exact: true }).click();
    await expect(detail.getByRole('button', { name: 'Askıya al', exact: true })).toBeVisible();
    await expect.poll(async () => (await (await scan.request.get(url)).text()).includes('assets/'), { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await (await page.request.get('/api/staff/support')).json()).license?.suspended, { timeout: 20_000 }).toBe(false);

    // The café computer off (its tunnel down): since 8 Ekim Mola Merkez shows the menu from its copy (the café sent it), with
    // ordering closed: "Şu an sipariş alınamıyor, lütfen garsonunuza sorun." (tests/browser/qr-ordering.spec.ts goes further;
    // the "Menü şu anda açılamıyor" page stays for a café that never sent a copy: tests/menu-mirror.test.ts).
    expect((await page.request.post('/api/test/tunnel', { data: { on: false } })).ok()).toBe(true);
    await expect.poll(async () => { const r = await scan.request.get(`${base}/api/guest/state`); return r.status(); }, { timeout: 10_000 }).toBe(503);
    await scan.goto(url);
    await expect(scan.getByRole('button', { name: /Demleme Çay/ })).toBeVisible({ timeout: 20_000 });
    await expect(scan.getByTestId('ordering-offline')).toContainText('Şu an sipariş alınamıyor, lütfen garsonunuza sorun.');
    expect(await fits(scan), 'menu copy 390px').toBe(true);
    // The menu that was already open says it lost the connection (no stack trace, its own words).
    await expect(guest.getByText('Şu an sipariş alınamıyor, lütfen garsonunuza sorun.').first()).toBeVisible({ timeout: 10_000 });
    // Back on: the same address opens the menu again.
    expect((await page.request.post('/api/test/tunnel', { data: { on: true } })).ok()).toBe(true);
    await expect.poll(async () => { const r = await scan.request.get(url); return r.status() === 200 && (await r.text()).includes('assets/'); }, { timeout: 15_000 }).toBe(true);
    await scan.goto(url);
    await expect(scan.getByRole('button', { name: /Demleme Çay/ })).toBeEnabled({ timeout: 20_000 });
  } finally { await guestContext.close(); await vendor.close(); }
});

test('İnternetten menü: a reserved table says so through Mola Merkez, and from Merkez\'s copy with the café computer away (12 Ekim)', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await expect.poll(async () => (await (await page.request.get('/api/staff/network')).json()).public?.connected ?? false, { timeout: 30_000 }).toBe(true);
  const base: string = (await (await page.request.get('/api/staff/network')).json()).public.base;
  const state = await (await page.request.get('/api/staff/state')).json(), table = state.tables[7], url = `${base}/${table.token}`;
  const vendor = await playwrightRequest.newContext(); await adminLogin(vendor);
  const copyAt = async () => (await (await vendor.get(`${ADMIN_API}/state`)).json()).businesses.find((b: any) => b.name === state.name).menu?.mirror?.updatedAt ?? '';
  const before = await copyAt();
  // A reservation a quarter of an hour from now (the café's clock): the table is held now.
  const at = new Date(Date.now() + 15 * 60_000 + 3 * 3600_000).toISOString(), time = at.slice(11, 16);
  expect((await page.request.post('/api/staff/reservations', { data: { requestId: `internet-resv-${Date.now()}`, tableId: table.id, day: at.slice(0, 10), time, name: 'Deniz', people: 2 } })).ok()).toBe(true);
  const reserved = `Bu masa ${time} için ayrılmıştır. Sipariş için lütfen garsonunuza sorun.`;
  // The copy follows the change a few seconds later (only the window: no name).
  await expect.poll(copyAt, { timeout: 30_000 }).not.toBe(before);
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await guestContext.route(`${KAFE}/**`, route => route.abort());
  try {
    const guest = await guestContext.newPage();
    await guest.goto(url);
    await expect(guest.getByRole('button', { name: /Demleme Çay/ })).toBeVisible({ timeout: 20_000 });
    await expect(guest.getByTestId('ordering-reserved')).toContainText(reserved);
    await expect(guest.getByRole('button', { name: 'Garson çağır' })).toBeEnabled();
    // The café computer away: Merkez answers from its copy and still says the table is reserved (not asking the café).
    expect((await page.request.post('/api/test/tunnel', { data: { on: false } })).ok()).toBe(true);
    await expect.poll(async () => (await guest.request.get(`${base}/api/guest/state`)).status(), { timeout: 10_000 }).toBe(503);
    const scan = await guestContext.newPage();
    await scan.goto(url);
    await expect(scan.getByRole('button', { name: /Demleme Çay/ })).toBeVisible({ timeout: 20_000 });
    await expect(scan.getByTestId('ordering-reserved')).toContainText(reserved);
    await expect(scan.getByTestId('ordering-offline')).toHaveCount(0);
    await expect(scan.getByRole('button', { name: 'Garson çağır' })).toBeDisabled();
    expect(await fits(scan)).toBe(true);
  } finally {
    await page.request.post('/api/test/tunnel', { data: { on: true } });
    const r = (await (await page.request.get(`/api/staff/reservations?from=${at.slice(0, 10)}&to=${at.slice(0, 10)}`)).json()).reservations.find((x: any) => x.name === 'Deniz');
    if (r) await page.request.post('/api/staff/reservations/cancel', { data: { requestId: `internet-resv-cancel-${Date.now()}`, id: r.id } });
    await guestContext.close(); await vendor.dispose();
  }
});

test('İnternetten menü: the owner is told to reprint Wi-Fi-only QR codes once the internet address is ready', async ({ page }) => {
  await page.request.post('/api/login', { data: { username: 'isletme', password: PASSWORD } });
  await ensureSetup(page.request);
  await expect.poll(async () => (await (await page.request.get('/api/staff/network')).json()).public?.base ?? '', { timeout: 30_000 }).not.toBe('');
  // An older printed set with the LAN address.
  expect((await page.request.post('/api/staff/qr-printed', { data: { origin: 'http://192.168.1.20:3000' } })).ok()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const notice = page.locator('.qr-internet-ready');
  await expect(notice).toContainText('Masa QR kodları internet adresiyle yeniden basılmalı.');
  await notice.getByRole('button', { name: "QR'ları yeniden yazdır" }).click();
  // It lands on Masalar ve QR → QR kodlarını yazdır: the reprint warning, the internet address for the new codes.
  await expect(page.locator('.qr-codes-card .qr-internet-ready')).toBeVisible();
  await expect(page.locator('.qr-codes-card .qr-print-address')).toContainText('İnternet adresi');
  await openSettings(page, 'Masalar ve QR');
  await expect(page.locator('.qr-codes-card .qr-internet-note')).toBeVisible();
  // Without the public address (an older Mola Merkez, here simulated): the Wi-Fi address and the note to reprint later.
  await page.route('**/api/staff/network', route => route.fulfill({ json: { lan: true, addresses: [{ name: 'Wi-Fi', origin: 'http://192.168.1.20:3000' }], publicProblem: 'old' } }));
  await page.reload();
  await openSettings(page, 'Masalar ve QR');
  await expect(page.locator('.qr-internet-pending')).toContainText('QR kodları internet adresi hazır olunca yeniden basılmalı.');
  await expect(page.locator('.qr-codes-card')).toContainText('192.168.1.20:3000');
  // Mola Merkez not on the internet yet (Mola Yönetim on a computer, before the VDS): the Wi-Fi address, never 127.0.0.1.
  await page.unroute('**/api/staff/network');
  await page.route('**/api/staff/network', route => route.fulfill({ json: { lan: true, addresses: [{ name: 'Wi-Fi', origin: 'http://192.168.1.20:3000' }], publicProblem: 'private' } }));
  await page.reload();
  await openSettings(page, 'Masalar ve QR');
  await expect(page.locator('.qr-internet-pending[data-problem="private"]')).toContainText('QR kodları şu an kafenin Wi-Fi adresini taşır; internet adresi Mola sunucusu (VDS) kurulunca gelir.');
  await expect(page.locator('.qr-codes-card')).toContainText('192.168.1.20:3000');
  await expect(page.locator('.qr-codes-card .qr-internet-note')).toHaveCount(0);
});
